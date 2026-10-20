/* Обертка над клиентской частью socket.io */

const Events = {
    Message: "message-received",
    ConversationCreated: "conversation-created",
    UserTyping: "user-typing",
    UserStatus: "user-status",
    MessagesStatus: "messages-status",
    MessageEdit: "message-edit",
    GroupLeft: "group-left",
    GroupJoin: "group-join"
};

const messageType = {
    system: 1,
    user: 10
};

const messageStatus = {
    created: 1,
    delivered: 10,
    readed: 20
};

const fileType = {
    image: 1,
    video: 10,
    audio: 20,
    doc: 30
};

const conversationType = {
    single: 1,
    group: 10
};

export default class ChatSocket {
    #socket = null;
    #emitter = null;

    constructor() {
        this.#socket = window.io();
        this.#emitter = window.document.createElement("span");

        this.#socket.on("user_message", this.#onUserMessage);
        this.#socket.on("conversation_created", this.#onConversationCreated);
        this.#socket.on("user_typing", this.#onUserTyping);
        this.#socket.on("user_status", this.#onUserStatus);
        this.#socket.on("messages_status", this.#onMessagesStatus);
        this.#socket.on("user_message_edit", this.#onMessagesEdit);
        this.#socket.on("left_group", this.#onGroupLeft);
        this.#socket.on("joined_to_group", this.#onGroupJoin)
    }

    #onUserMessage = model => this.#raiseEvent(Events.Message, model);
    #onConversationCreated = model => this.#raiseEvent(Events.ConversationCreated, model);
    #onUserTyping = model => this.#raiseEvent(Events.UserTyping, model);
    #onUserStatus = model => this.#raiseEvent(Events.UserStatus, model);
    #onMessagesStatus = model => this.#raiseEvent(Events.MessagesStatus, model);
    #onMessagesEdit = model => this.#raiseEvent(Events.MessageEdit, model);
    #onGroupLeft = model => this.#raiseEvent(Events.GroupLeft, model);
    #onGroupJoin = model => this.#raiseEvent(Events.GroupJoin, model);

    #raiseEvent(type, data = null) {
        const event = new Event(type);
        event.data = data;

        this.#emitter.dispatchEvent(event);
    }

    async create(participants, initalContent, attachments = []) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("create_conversation",
                    JSON.stringify({ participants, content: initalContent, attachments }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return model;
        } catch (e) {
            throw new Error(`Conversation has not created: ${e.message}`);
        }
    }

    async createGroup(participants, name) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("create_group_conversation",
                    JSON.stringify({ participants, name }));

            return JSON.parse(response);
        } catch (e) {
            throw new Error(`Conversation has not created: ${e.message}`);
        }
    }

    async leaveGroup(room, userId) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("leave_group",
                    JSON.stringify({ room, userId }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`User has not left group: ${e.message}`);
        }
    }

    async joinToGroup(room, userId) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("join_to_group",
                    JSON.stringify({ room, userId }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`User has not joined to group: ${e.message}`);
        }
    }

    async send(room, content, attachments = [], replyTo = null) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("message",
                    JSON.stringify({
                        room, content, attachments, replyTo
                    }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`Message has not sended: ${e.message}`);
        }
    }

    async edit(room, id, content, attachments = []) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("message_edit",
                    JSON.stringify({
                        room, id, content, attachments
                    }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`Message has not edited: ${e.message}`);
        }
    }

    async forward(room, id, toRoom) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("message_forward",
                    JSON.stringify({
                        message: { id, room }, toRoom
                    }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`Message has not forwarded: ${e.message}`);
        }
    }

    async join(rooms) {
        try {
            await this.#socket
                .timeout(5000)
                .emitWithAck("join", JSON.stringify(rooms));
        } catch (e) {
            throw new Error("Join has not succesed");
        }
    }

    async leave(room) {
        try {
            await this.#socket
                .timeout(5000)
                .emitWithAck("leave", room);
        } catch (err) {
            throw new Error("Leave has not succesed");
        }
    }

    async typing(room) {
        try {
            await this.#socket
                .timeout(5000)
                .emitWithAck("typing", room);
        } catch (err) {
            throw new Error("Typing has not succesed");
        }
    }

    async readed(room, readed) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("messages_readed",
                    JSON.stringify({
                        room, readed
                    }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return model;
        } catch (e) {
            throw new Error(`Readed has not successed: ${e.message}`);
        }
    }

    async delivered(room, delivered) {
        try {
            const response = await this.#socket
                .timeout(5000)
                .emitWithAck("messages_delivered",
                    JSON.stringify({
                        room, delivered
                    }));

            const model = JSON.parse(response);
            if (model.error != null) {
                throw new Error(model.error);
            }

            return true;
        } catch (e) {
            throw new Error(`Delivered has not successed: ${e.message}`);
        }
    }

    onChatCreated(callback) {
        this.#emitter.addEventListener(Events.ConversationCreated, callback);
    }
    
    onMessage(callback) {
        this.#emitter.addEventListener(Events.Message, callback);
    }

    onUserTyping(callback) {
        this.#emitter.addEventListener(Events.UserTyping, callback);
    }

    onUserStatus(callback) {
        this.#emitter.addEventListener(Events.UserStatus, callback);
    }

    onMessagesStatus(callback) {
        this.#emitter.addEventListener(Events.MessagesStatus, callback);
    }

    onMessageEdit(callback) {
        this.#emitter.addEventListener(Events.MessageEdit, callback);
    }

    onGroupLeft(callback) {
        this.#emitter.addEventListener(Events.GroupLeft, callback);
    }

    onGroupJoin(callback) {
        this.#emitter.addEventListener(Events.GroupJoin, callback);
    }
}

export { messageType, messageStatus, fileType, conversationType };