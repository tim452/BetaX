import Cookies from "cookies";
import sessionStore from "./sessionStore.js";
import { v4 as uuid } from "uuid";
import fs from "fs";
import path from "path";
import mongo from "./mongoose.js";
import { Server } from "socket.io";
import { User } from "../models/User.js";
import { Conversation, messageType, messageStatus, conversationType } from "../models/Conversation.js";

const maxAttachments = 10;

class Chat {
    #io = null;
    #socketMap = new Map();

    listen(server) {
        this.#io = new Server(server);

        this.#init();
    }

    #init() {
        this.#io.use(async (socket, next) => {
            try {
                const cookies = new Cookies(socket.request, {});
                const sid = cookies.get("koa.sess");
                const session = await sessionStore.get(sid);

                if (session == null) {
                    throw new Error("No session");
                }

                if (!session.passport && !session.passport.user) {
                    throw new Error("Anonymous session not allowed");
                }
                    
                const user = await User.findById(session.passport.user);
                user.online = true.toString();

                socket.user = await user.save();

                if (!this.#socketMap.has(session.passport.user)) {
                    this.#socketMap.set(session.passport.user, []);
                }

                this.#socketMap
                    .get(session.passport.user)
                    .push(socket.id);
            } catch (e) {
                console.error(e);
            } finally {
                next();
            }
        });

        this.#io.on("connection", async socket => {
            if (socket.user == null) {
                return;
            }

            await this.#userStatus(socket.user.id, socket.user.online);

            socket.on("disconnect", async () => {
                try {
                    const socketIds = this.#socketMap.get(socket.user.id);
                    socketIds.splice(socketIds.indexOf(socket.id), 1);

                    if (socketIds.length === 0) {
                        this.#socketMap.delete(socket.user.id);

                        const now = Date.now().toString();

                        await User.updateOne({ _id: socket.user.id }, { online: now });
                        await this.#userStatus(socket.user.id, now);
                    }
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("create_conversation", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const message = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#conversationGuard([...message.participants, author])) {
                        ack(JSON.stringify({
                            error: "Conversation with matched participants already exists"
                        }));
                        return;
                    }

                    const conversation = await this.#createConversation(message, author);

                    socket.join(conversation.room);

                    await Conversation.populate(conversation, { path: "participants messages.author" });

                    ack(JSON.stringify(Object.assign(conversation.toModel(), { unreads: 0 })));
                    
                    conversation.messages.forEach(msg => {
                        const { type, content, created, id, status, attachments, isEdited, replyTo } = msg;
                        const formatMessage = Object.assign({},
                            { type, content, created, id, status, attachments, isEdited, replyTo },
                            { author: socket.user.toModel() });

                        this.#sendMessage(conversation.room, formatMessage);
                    });

                    const participants = conversation.participants
                        .map(x => x.id)
                        .filter(id => id !== author);
                    participants.forEach(participant => {
                        const participantSockets = this.#socketMap.get(participant);
                        participantSockets?.forEach(x => {
                            this.#io.to(x).emit("conversation_created",
                                Object.assign(conversation.toModel(),
                                    { unreads: conversation.messages.length - 1 }));
                        });
                    });
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("create_group_conversation", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { participants, name } = JSON.parse(payload);
                    const author = socket.user.id;

                    const conversation = await this.#createGroupConversation(participants, name, author);

                    socket.join(conversation.room);

                    await Conversation.populate(conversation, { path: "participants messages.author" });

                    ack(JSON.stringify(Object.assign(conversation.toModel(), { unreads: 0 })));

                    conversation.messages.forEach(msg => {
                        const { type, content, created, id, status, attachments, isEdited, replyTo } = msg;
                        const formatMessage = Object.assign({},
                            { type, content, created, id, status, attachments, isEdited, replyTo },
                            { author: socket.user.toModel() });

                        this.#sendMessage(conversation.room, formatMessage);
                    });
                    
                    participants.forEach(participant => {
                        const participantSockets = this.#socketMap.get(participant);
                        participantSockets?.forEach(x => {
                            this.#io.to(x).emit("conversation_created",
                                Object.assign(conversation.toModel(), { unreads: 0 }));
                        });
                    });
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("message", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }
                    
                    const { room, content: messageContent,
                        attachments, replyTo } = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#roomGuard(room, author)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    const conversation = await Conversation.findOne({ room },
                        { _id: 0, participants: 1 });
                    if (conversation == null) {
                        ack(JSON.stringify({
                            error: "Conversation not found"
                        }));
                        return;
                    }

                    let replyMessage = null;
                    if (replyTo != null) {
                        const replyConversation = await Conversation.findOne({
                            room, "messages._id": replyTo
                        }, {
                            "messages.$": 1
                        }).populate("messages.author");

                        const [messageOnReply] = replyConversation.messages;
                        const { content: replyContent, author: replyAuthor,
                            attachments: replyAttachments } = messageOnReply;
                        const safeAttachments = [];

                        for (let attachment of replyAttachments) {
                            const { name, originalName, type } = attachment;
                            const newName = `${uuid()}${path.extname(name)}`;

                            await fs.promises.copyFile(path.join(path.resolve("uploads"), name),
                                path.join(path.resolve("uploads"), newName));

                            safeAttachments.push({
                                originalName, type, name: newName
                            })
                        }

                        replyMessage = {
                            id: replyTo,
                            author: `${replyAuthor.surname} ${replyAuthor.name}`,
                            content: replyContent,
                            attachments: safeAttachments
                        };
                    }

                    const id = new mongo.Types.ObjectId();
                    const message = {
                        _id: id,
                        type: messageType.user,
                        author,
                        replyTo: replyMessage,
                        content: messageContent,
                        created: new Date(), 
                        unread: conversation.participants.filter(x => String(x) !== author),
                        status: messageStatus.created,
                        attachments: attachments.slice(0, maxAttachments) ?? [],
                        isEdited: false
                    };

                    await Conversation.updateOne({ room }, { "$push": { messages: message } });

                    ack(JSON.stringify({
                        success: true
                    }));
                    
                    const { type, content, created, unread, status,
                        replyTo: replyToMessage, isEdited, attachments: addedAttachments } = message;
                    const msg = Object.assign({},
                        {
                            type, content, created, id: String(id), unread, status,
                            replyTo: replyToMessage, attachments: addedAttachments, isEdited
                        },
                        { author: socket.user.toModel() });

                    this.#sendMessage(room, msg);
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("message_edit", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { room, id, content, attachments } = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#roomGuard(room, author)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    if (!await this.#editingMessagesGuard(room, id, author)) {
                        ack(JSON.stringify({
                            error: "You cannot modified the message"
                        }));
                        return;
                    }

                    const conversation = await Conversation.findOne({ room },
                        { _id: 0, participants: 1 });
                    if (conversation == null) {
                        ack(JSON.stringify({
                            error: "Conversation not found"
                        }));
                        return;
                    }

                    const unread = conversation.participants.filter(x => String(x) !== author);

                    await Conversation.updateOne({ room },
                        {
                            "$set": {
                                "messages.$[elem].content": content,
                                "messages.$[elem].edited": new Date(),
                                "messages.$[elem].unread": unread,
                                "messages.$[elem].status": messageStatus.created,
                                "messages.$[elem].attachments": attachments.slice(0, maxAttachments),
                                "messages.$[elem].isEdited": true,
                            }
                        },
                        {
                            "arrayFilters": [{ "elem._id": id }]
                        }
                    );

                    ack(JSON.stringify({
                        success: true
                    }));

                    const updatedConversation = await Conversation.findOne({
                        room, "messages._id": id
                    }, {
                        "messages.$": 1
                    });
                    const [message] = updatedConversation.messages;
                    const { type, created, status, isEdited, edited, replyTo,
                        attachments: editedAttachments } = message;
                    const msg = Object.assign({},
                        {
                            id, type, content, created, edited, unread, replyTo, status,
                            attachments: editedAttachments, isEdited
                        },
                        { author: socket.user.toModel() });

                    for (let participant of conversation.participants) {
                        const conversations = await Conversation.aggregate([{ "$match": { room } },
                        {
                            "$project": {
                                _id: 0,
                                unreads: {
                                    "$size": {
                                        "$filter": {
                                            input: "$messages",
                                            as: "msg",
                                            cond: {
                                                "$eq": [{
                                                    "$size": {
                                                        "$filter": {
                                                            input: "$$msg.unread",
                                                            as: "unr",
                                                            cond: { "$eq": ["$$unr", participant] }
                                                        }
                                                    }
                                                }, 1]
                                            }
                                        }
                                    }
                                },
                            }
                        }]);
                        const { unreads: unreadCount } = conversations[0];

                        const participantSockets = this.#socketMap.get(String(participant));
                        participantSockets?.forEach(x => {
                            this.#io.to(x).emit("user_message_edit", {
                                room, unreadCount, ...msg
                            });
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("message_forward", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { message: { id, room }, toRoom } = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#roomGuard(toRoom, author)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    const targetConversation = await Conversation.findOne({ room: toRoom },
                        { _id: 0, participants: 1 });
                    if (targetConversation == null) {
                        ack(JSON.stringify({
                            error: "Conversation not found"
                        }));
                        return;
                    }

                    const sourceConversation = await Conversation.findOne({
                        room, "messages._id": id
                    }, {
                        "messages.$": 1
                    }).populate("messages.author");
                    const [sourceMessage] = sourceConversation.messages;
                    const { content, attachments, author: { surname, name } } = sourceMessage;
                    const safeAttachments = [];

                    for (let attachment of attachments) {
                        const { name, originalName, type } = attachment;
                        const newName = `${uuid()}${path.extname(name)}`;

                        await fs.promises.copyFile(path.join(path.resolve("uploads"), name),
                            path.join(path.resolve("uploads"), newName));

                        safeAttachments.push({
                            originalName, type, name: newName
                        })
                    }

                    const newId = new mongo.Types.ObjectId();
                    const newMessage = {
                        _id: newId,
                        type: messageType.user,
                        author,
                        replyTo: null,
                        forwarded: `${surname} ${name}`,
                        content,
                        created: new Date(),
                        unread: targetConversation.participants.filter(x => String(x) !== author),
                        status: messageStatus.created,
                        attachments: safeAttachments,
                        isEdited: false
                    };

                    await Conversation.updateOne({ room: toRoom }, { "$push": { messages: newMessage } });

                    ack(JSON.stringify({
                        success: true
                    }));

                    const { type, created, unread, status, isEdited, forwarded } = newMessage;
                    const msg = Object.assign({},
                        {
                            type, content, created, id: String(newId), unread, status,
                            attachments: safeAttachments, isEdited, forwarded
                        },
                        { author: socket.user.toModel() });

                    this.#sendMessage(toRoom, msg);
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("messages_readed", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { room, readed } = JSON.parse(payload);

                    if (!await this.#roomGuard(room, socket.user.id)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    await Conversation.updateOne({ room },
                        {
                            "$pull": { "messages.$[elem].unread": socket.user.id },
                            "$set": { "messages.$[elem].status": messageStatus.readed }
                        },
                        {
                            "arrayFilters": [{ "elem._id": { "$in": readed } }]
                        }
                    );

                    const conversations = await Conversation.aggregate([{ "$match": { room } },
                    {
                        "$project": {
                            _id: 0,
                            type: 1,
                            unreads: {
                                "$size": {
                                    "$filter": {
                                        input: "$messages",
                                        as: "msg",
                                        cond: {
                                            "$eq": [{
                                                "$size": {
                                                    "$filter": {
                                                        input: "$$msg.unread",
                                                        as: "unr",
                                                        cond: { "$eq": ["$$unr", socket.user._id] }
                                                    }
                                                }
                                            }, 1]
                                        }
                                    }
                                }
                            },
                        }
                    }]);
                    const { unreads, type } = conversations[0];

                    ack(JSON.stringify({
                        unreads, room
                    }));

                    if (type === conversationType.group) {
                        return;
                    }

                    socket.to(room).emit("messages_status",
                        { room, status: messageStatus.readed, messages: readed });
                } catch (e) {
                    console.error(e);
                }
            });
            
            socket.on("messages_delivered", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { room, delivered } = JSON.parse(payload);
                    const author = socket.user.id;
                    if (!await this.#roomGuard(room, author)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    const conversations = await Conversation.aggregate([{ "$match": { room } },
                    {
                        "$project": {
                            _id: 0,
                            type: 1,
                            messages: {
                                "$filter": {
                                    input: "$messages",
                                    as: "msg",
                                    cond: {
                                        "$eq": ["$$msg.author._id", author]
                                    }
                                }
                            }
                        }
                    }]);
                    const { messages, type } = conversations[0];

                    if (type === conversationType.group) {
                        ack(JSON.stringify({
                            success: true
                        }));
                        return;
                    }

                    const messagesToProcess = delivered
                        .filter(x => messages.find(y => String(y._id) === x) == null);

                    await Conversation.updateOne({ room },
                        {
                            "$set": { "messages.$[elem].status": messageStatus.delivered }
                        },
                        {
                            "arrayFilters": [{ "elem._id": { "$in": messagesToProcess } }]
                        }
                    );

                    ack(JSON.stringify({
                        success: true
                    }));

                    socket.to(room).emit("messages_status",
                        { room, status: messageStatus.delivered, messages: messagesToProcess });
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("join", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const rooms = JSON.parse(payload);
                    const allowRooms = [];
                    for (let room of rooms) {
                        if (await this.#roomGuard(room, socket.user.id)) {
                            allowRooms.push(room);
                        }
                    }

                    if (allowRooms.length > 0) {
                        socket.join(rooms);
                    }

                    ack();
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("leave", (room, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    socket.leave(room);
                    ack();
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("leave_group", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { room, userId } = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#leaveGroupGuard(room, userId, author)) {
                        ack(JSON.stringify({
                            error: "You cannot perform the operation"
                        }));
                        return;
                    }

                    await Conversation.updateOne({ room }, { "$pull": { participants: userId } });

                    ack(JSON.stringify({
                        success: true
                    }));

                    this.#io.to(room).emit("left_group", { room, userId });
                    
                    const user = await User.findById(userId);
                    const id = new mongo.Types.ObjectId();
                    const message = {
                        _id: id,
                        type: messageType.system,
                        author,
                        content: `${user.surname} ${user.name} покинул(а) беседу`,
                        replyTo: null,
                        created: new Date(),
                        unread: [],
                        status: messageStatus.created,
                        attachments: [],
                        isEdited: false
                    }

                    await Conversation.updateOne({ room }, { "$push": { messages: message } });

                    const { type, content, created, unread, status,
                        replyTo, attachments, isEdited } = message;
                    const msg = Object.assign({},
                        {
                            type, content, created, id: String(id), unread, status,
                            replyTo, attachments, isEdited
                        },
                        { author: socket.user.toModel() });

                    this.#sendMessage(room, msg);
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("join_to_group", async (payload, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    const { room, userId } = JSON.parse(payload);
                    const author = socket.user.id;

                    if (!await this.#groupAdminGuard(room, author)) {
                        ack(JSON.stringify({
                            error: "You cannot perform the operation"
                        }));
                        return;
                    }

                    await Conversation.updateOne({ room }, { "$push": { participants: userId } });

                    ack(JSON.stringify({
                        success: true
                    }));

                    const user = await User.findById(userId);

                    this.#io.to(room).emit("joined_to_group", { room, participant: user.toModel() });

                    const conversation = await Conversation
                        .findOne({ room }, { messages: { "$slice": [-1, 1] } })
                        .populate("participants messages.author");

                    const participantSockets = this.#socketMap.get(userId);
                    participantSockets?.forEach(x => {
                        this.#io.to(x).emit("conversation_created",
                            Object.assign(conversation.toModel(),
                                { unreads: 0 }));
                    });

                    const id = new mongo.Types.ObjectId();
                    const message = {
                        _id: id,
                        type: messageType.system,
                        author,
                        content: `${user.surname} ${user.name} присоединился(ась) к беседе`,
                        replyTo: null,
                        created: new Date(),
                        unread: [],
                        status: messageStatus.created,
                        attachments: [],
                        isEdited: false
                    }

                    await Conversation.updateOne({ room }, { "$push": { messages: message } });

                    const { type, content, created, unread, status,
                        replyTo, attachments, isEdited } = message;
                    const msg = Object.assign({},
                        {
                            type, content, created, id: String(id), unread, status,
                            replyTo, attachments, isEdited
                        },
                        { author: socket.user.toModel() });

                    this.#sendMessage(room, msg);
                } catch (e) {
                    console.error(e);
                }
            });

            socket.on("typing", async (room, ack) => {
                try {
                    if (socket.user == null) {
                        throw new Error("No user at socket");
                    }

                    if (!await this.#roomGuard(room, socket.user.id)) {
                        ack(JSON.stringify({
                            error: "You do not have access to room"
                        }));
                        return;
                    }

                    socket.to(room).emit("user_typing", { room, user: socket.user.toModel() });

                    ack();
                } catch (e) {
                    console.error(e);
                }
            });
        });
    }

    #sendMessage(room, message) {
        this.#io.to(room).emit("user_message", {
            room, ...message
        });
    }

    async #userStatus(userId, status) {
        const conversations = await Conversation.find({ participants: userId }, { _id: 0, participants: 1 });
        if (conversations.length === 0) {
            return;
        }

        const collaborators = conversations
            .map(x => x.participants.map(y => String(y)))
            .flat()
            .filter(id => id !== userId)
            .reduce((acc, x) => !acc.includes(x) ? [x, ...acc] : acc, []);
            
        for (let collaborator of collaborators) {
            const collaboratorSockets = this.#socketMap.get(collaborator);
            collaboratorSockets?.forEach(x => {
                this.#io.to(x).emit("user_status", { user: userId, status });
            });
        }
    }

    async #createConversation(message, author) {
        const { participants, content, attachments } = message;
        const room = `room_${uuid()}`;
        const model = {
            room,
            participants: [...participants, author],
            messages: [{
                type: messageType.system,
                author,
                content: "Беседа создана",
                replyTo: null,
                created: new Date(),
                unread: [],
                status: messageStatus.created,
                attachments: [],
                isEdited: false
            }],
            type: conversationType.single
        };

        const conversation = await Conversation.create(model);

        conversation.messages.push({
            type: messageType.user,
            author,
            content: content ?? "",
            replyTo: null,
            created: new Date(),
            unread: participants,
            status: messageStatus.created,
            attachments: attachments ?? [],
            isEdited: false
        });

        return await conversation.save();
    }

    async #createGroupConversation(participants, name, author) {
        const room = `room_${uuid()}`;
        const model = {
            room,
            participants: [...participants, author],
            messages: [{
                type: messageType.system,
                author,
                content: "Групповая беседа создана",
                replyTo: null,
                created: new Date(),
                unread: [],
                status: messageStatus.created,
                attachments: [],
                isEdited: false
            }],
            type: conversationType.group,
            groupName: name,
            groupAdmin: author
        };

        const conversation = await Conversation.create(model);
        const users = await User.find({ _id: { "$in": [...participants, author] } });
        const usersString = users
            .map(x => {
                const { name, surname } = x.toModel();
                return `${surname} ${name}`;
            })
            .join(", ");

        conversation.messages.push({
            type: messageType.system,
            author,
            content: `К беседе присоединились: ${usersString}`,
            replyTo: null,
            created: new Date(),
            unread: [],
            status: messageStatus.created,
            attachments: [],
            isEdited: false
        });

        return await conversation.save();
    }

    async #conversationGuard(participants) {
        const conversation = await Conversation.findOne({
            type: conversationType.single,
            participants: {
                "$size": participants.length,
                "$all": participants
            }
        }, { _id: 1 });
        if (conversation != null) {
            return false;
        }

        return true;
    }

    async #roomGuard(room, userId) {
        const conversation = await Conversation.findOne({ room, participants: userId }, { _id: 1 });

        return conversation != null;
    }

    async #editingMessagesGuard(room, messageId, author) {
        const conversation = await Conversation.findOne({
            room, "messages._id": messageId
        }, {
            "messages.$": 1
        });

        const [message] = conversation.messages;

        return String(message.author) === author && message.forwarded == null;
    }

    async #leaveGroupGuard(room, userId, author) {
        const conversation = await Conversation.findOne({ room, participants: userId },
            { type: 1, groupAdmin: 1 });
        if (conversation == null || conversation.type !== conversationType.group) {
            return false;
        }

        if (userId !== author && String(conversation.groupAdmin) !== author) {
            return false;
        }

        if (String(conversation.groupAdmin) === userId) {
            return false;
        }

        return true;
    }

    async #groupAdminGuard(room, author) {
        const conversation = await Conversation.findOne({ room, groupAdmin: author },
            { _id: 1 });

        return conversation != null;
    }
}

export default new Chat();