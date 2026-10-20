import { Conversation } from "../models/Conversation.js";
import { User } from "../models/User.js";

const PageSize = 20;

class ConversationRoutes {
    async getByUser(ctx) {
        const { id } = ctx.params;

        const user = await User.findById(id);
        if (user == null) {
            ctx.status = 404;
            return;
        }

        const conversations = await Conversation.aggregate([{ "$match": { participants: user._id } },
        {
            "$project": {
                _id: 0,
                room: 1,
                updatedAt: 1,
                participants: 1,
                type: 1,
                groupName: 1,
                groupAdmin: 1,
                lastMessage: { "$arrayElemAt": ["$messages", -1] },
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
                                            cond: { "$eq": ["$$unr", user._id] }
                                        }
                                    }
                                }, 1]
                            }
                        }
                    }
                },
            }
        },
        { "$sort": { updatedAt: -1 } }]);

        await Conversation.populate(conversations, { path: "participants lastMessage.author" });
        
        ctx.body = conversations.map(x => Conversation.toExtendModel(x));
        ctx.status = 200;
    }

    async getMessages(ctx) {
        const { room } = ctx.params;
        let { page, size } = ctx.query

        page = !isNaN(Number(page)) ? Number(page) : 0;
        size = !isNaN(Number(size)) ? Number(size) : PageSize;

        const offset = -(size * (page + 1));
        const aggregates = await Conversation.aggregate([{ "$match": { room } },
            { "$project": { _id: 0, count: { "$size": "$messages" } } }]);
        const count = aggregates.length > 0 ? aggregates[0].count : size;
        const pageSize = count + offset >= 0 ? size : size + (count + offset);

        if (pageSize === 0) {
            ctx.body = {
                room,
                messages: [],
                nextUrl: null
            };
            ctx.status = 200;
            return;
        }

        const conversation = await Conversation
            .findOne({ room }, { messages: { "$slice": [offset, pageSize] } })
            .populate("messages.author");

        if (conversation == null) {
            ctx.status = 404;
            return;
        }

        const { messages } = conversation;
        messages.sort((a, b) => b.created - a.created);
        
        const nextUrl = messages.length === size ?
            `api/conversation/messages/${room}?page=${++page}&size=${size}` :
            null;

        ctx.body = {
            room,
            messages: messages.map(x => Conversation.messageToModel(x)),
            nextUrl
        };
        ctx.status = 200;
    }
}

export default new ConversationRoutes();