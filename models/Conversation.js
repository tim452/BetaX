import mongoose from "../libs/mongoose.js";

const conversationSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    }],
    room: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        unique: true
    },
    messages: [{
        type: {
            type: Number,
            required: true
        },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        content: {
            type: String,
            trim: true
        },
        created: {
            type: Date,
            required: true
        },
        edited: {
            type: Date
        },
        isEdited: {
            type: Boolean,
            required: true
        },
        unread: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }],
        status: {
            type: Number,
            required: true
        },
        attachments: [{
            type: {
                type: Number,
                required: true
            },
            name: {
                type: String,
                required: true,
                trim: true
            },
            originalName: {
                type: String,
                required: true,
                trim: true
            }
        }],
        replyTo: {
            id: {
                type: String
            },
            author: {
                type: String
            },
            content: {
                type: String
            },
            attachments: [{
                type: {
                    type: Number,
                    required: true
                },
                name: {
                    type: String,
                    required: true,
                    trim: true
                },
                originalName: {
                    type: String,
                    required: true,
                    trim: true
                }
            }]
        },
        forwarded: {
            type: String
        }
    }],
    lastMessage: {
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    },
    unreads: {
        type: Number
    },
    type: {
        type: Number,
        required: true
    },
    groupName: {
        type: String
    },
    groupAdmin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }
}, {
    timestamps: true
});

conversationSchema.methods.toModel = function () {
    const { room, updatedAt, participants, messages, type, groupName, groupAdmin } = this;
    const lastMessage = messages[messages.length - 1];
    
    return {
        room,
        participants: participants.map(x => x.toModel()),
        updatedAt,
        lastMessage: messageToModel(lastMessage),
        type,
        groupName,
        groupAdmin
    };
};

function messageToModel(message) {
    const { type, _id, author, content, created, edited, unread, forwarded,
        status, attachments, isEdited, replyTo } = message;

    return {
        id: String(_id),
        type,
        author: author.toModel(),
        content,
        created,
        edited,
        unread,
        status,
        attachments,
        isEdited,
        replyTo,
        forwarded
    }
}

const Conversation = mongoose.model("Conversation", conversationSchema);

Conversation.toExtendModel = function (conversation) {
    const { room, updatedAt, participants, lastMessage,
        unreads, type, groupName, groupAdmin } = conversation;

    return {
        room,
        participants: participants.map(x => x.toModel()),
        lastMessage: messageToModel(lastMessage),
        updatedAt,
        unreads,
        type,
        groupName,
        groupAdmin
    }
}

Conversation.messageToModel = messageToModel;

const messageType = {
    system: 1,
    user: 10
};

const messageStatus = {
    created: 1,
    delivered: 10,
    readed: 20
};

const conversationType = {
    single: 1,
    group: 10
};

export { Conversation, messageType, messageStatus, conversationType };