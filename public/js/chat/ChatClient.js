import ChatSocket, { messageType, messageStatus, fileType, conversationType } from "./ChatSocket.js";

let PageSize = 25;

const data = {
    user: null,
    conversations: [],
    room: null,
    users: [],
    attachments: [],
    attachmentsToDelete: [],
    messages: [],
    editMessage: null,
    replyMessage: null,
    participantsToGroup: []
};

let socket = null;
let paging = null;
let unreadWatcher = null;

async function init(user, pageSize = 25) {
    PageSize = pageSize;

    paging = new MessagesPaging($(".chat .messages").get(0));
    unreadWatcher = new UnreadWatcher($(".chat .messages").get(0), processReaded);

    data.user = user;

    initSocket();
    initParticipantSearch();
    initConversationItems();
    initFileSelector();
    initMessageActions();
    initGroupCreator();
    
    await loadConversations();

    updateTimeLabels();
}

function initSocket() {
    socket = new ChatSocket();
    socket.onMessage(onMessageReceived);
    socket.onChatCreated(onChatCreated);
    socket.onUserTyping(onUserTyping());
    socket.onUserStatus(onUserStatus);
    socket.onMessagesStatus(onMessagesStatus);
    socket.onMessageEdit(onMessageEdit);
    socket.onGroupLeft(onGroupLeft);
    socket.onGroupJoin(onGroupJoin);
}

function initParticipantSearch() {
    $("body").on("click", () => $(".participants .list").addClass("hidden"));
    $(".participants").on("click", e => e.stopImmediatePropagation());

    $(".participants input").each((i, input) => $(input).on("keypress",
        debounce(participantMatch.bind(input), 250)));

    $(".conversations .participants .list").on("click", ".item", participantSelect);
}

function initConversationItems() {
    $(".conversations > .list").on("click", ".item", conversationItemClick);
}

function initFileSelector() {
    $("#selectFiles").on("click", e => {
        e.stopImmediatePropagation();

        $("#selectFiles .select-files-type").toggleClass("hidden");
    });
    $("#selectFiles .select-files-type").on("click", "[data-file-type]", fileTypeClick);
    $("body").on("click", () => $("#selectFiles .select-files-type").addClass("hidden"));
    $(".chat .controls .content .attachments").on("click", ".file:not(.attachment) .control-panel .delete", removeAttachment);
    $(".chat .controls .content .attachments").on("click", ".file.attachment .control-panel .delete", prepareToDeleteAttachment);
    $(".chat .controls .content .attachments").on("click", ".file .control-panel .play", playAudio);
    $(".chat .controls .content .attachments").on("click", ".file .control-panel .stop", stopAudio);
}

function initMessageActions() {
    $(".chat .messages").on("contextmenu", ".item:not(.system) .content .text", showMessageMenu);
    $(".chat .messages").on("click", ".item-menu .action.edit", toEditMessage);
    $(".chat .messages").on("click", ".item-menu .action.reply", toReplyMessage);
    $(".chat .messages").on("click", ".item-menu .action.forward", toForwardMessage);
    $(".chat .messages").on("click", ".item .content .text .reply-to", replySelect);
    $("body").on("click", () => $(".chat .messages .item-menu").remove());
    document.body.addEventListener("click", e => {
        if ($(e.target).closest(".chat-selector").length !== 0) {
            return;
        }

        $(".chat-selector").remove();
    }, true);
    $("body").on("click", ".chat-selector .room", forwardMessage);

    $("#cancel").on("click", resetChatControls);
}

function initGroupCreator() {
    $("#toGroupCreate").on("click",
        () => $(".group-creator").off("transitionend").removeClass("under-back").addClass("shown"));
    $("#cancel-create-group").on("click", () => {
        if ($(".group-creator").attr("data-processing") === true.toString()) {
            return;
        }

        $(".group-creator .dialog .dialog-body .participants-list")
            .empty()
            .append(`<div class="splash">
                                <span class="text">Выберите участников беседы</span>
                        </div>`);
        $("#groupName, .group-creator .dialog .participants input").val("");
        $(".group-creator .dialog .participants .list").empty().addClass("hidden");
        $(".group-creator").one("transitionend",
            () => $(".group-creator").addClass("under-back")).removeClass("shown");
        $("#groupName, .group-creator .dialog .dialog-body .participants-list")
            .removeClass("invalid")
            .off("animationend");

        data.participantsToGroup.length = 0;
    });

    $(".group-creator .participants .list").on("click", ".item", participantSelectToGroup);
    $(".group-creator .dialog .dialog-body .participants-list").on("click", ".item", function () {
        const item = $(this);
        const id = item.attr("data-id");
        const index = data.participantsToGroup.findIndex(x => x === id);

        data.participantsToGroup.splice(index, 1);
        item.remove();

        if (data.participantsToGroup.length === 0) {
            $(".group-creator .dialog .dialog-body .participants-list").append(`<div class="splash">
                            <span class="text">Выберите участников беседы</span>
                        </div>`);
        }
    });

    $("#create-group").on("click", createGroupConversation);
    $(".chat .group-status .group-participants").on("click", showGroupParticipants);
    document.body.addEventListener("click", e => {
        if ($(e.target).closest(".group-participants-view").length !== 0) {
            return;
        }

        $(".group-participants-view").remove();
    }, true);

    $("#leaveGroup").on("click", leaveGroup);
    $("#dropFromGroup").on("click", prepareToDrop);
    document.body.addEventListener("click", e => {
        if ($(e.target).closest(".group-participants-view-to-drop").length !== 0) {
            return;
        }

        $(".group-participants-view-to-drop").off().remove();
    }, true);
    $(".chat .group-actions .participants .list").on("click", ".item", addToGroup);
}

/* Обновление временных меток, которые выражены фразами типа: минуту назад */
function updateTimeLabels() {
    function update() {
        const labels = $(".time.pretty");
        labels.each((i, label) => {
            label = $(label);
            const timestamp = Number(label.attr("data-time"));

            setMessageDate(label, timestamp);
        });

        setTimeout(update, 1000 * 30);
    }

    setTimeout(update, 1000 * 30);
}

/* Отложить выполнение функции */
function debounce(fn, delay = 1000) {
    let timer = null;

    return (...args) => {
        clearTimeout(timer);

        timer = setTimeout(() => fn(...args), delay);
    }
}

/* Выполнять функцию один раз за интервал времени  */
function throttle(fn, timeout) {
    let isThrottled = false;

    return (...args) => {
        if (isThrottled) {
            return;
        }

        isThrottled = true;
        setTimeout(() => isThrottled = false, timeout);

        return fn(...args);
    };
}

/* Поиск собеседников */
async function participantMatch() {
    const input = $(this);
    const list = input.closest(".participants").find(".list");
    list.empty();

    const pattern = input.val().trim();
    if (pattern.length < 2) {
        return;
    }

    const response = await fetch(`api/user/search/${pattern}`);
    if (response.ok) {
        const users = await response.json();
        const match = users.filter(user => user.id !== data.user.id);
        match.forEach(user =>
            list.append(`<span class="item" data-id="${user.id}">${user.surname} ${user.name}</span>`));

        if (match.length > 0) {
            list.removeClass("hidden");
        }

        data.users = match;
    }
}

/* Выбор собеседника из списка */
function participantSelect() {
    const id = $(this).attr("data-id");

    $(".conversations .participants input").val("");
    $(".conversations .participants .list").addClass("hidden");

    /* Если есть беседа с этим участником, выбираем ее, иначе создать беседу */
    const conversation = data.conversations
        .find(x => x.type === conversationType.single &&
            x.participants.find(y => y.id === id) != null);
    if (conversation != null) {
        const item = $(`.conversations > .list .item[data-room='${conversation.room}']`);

        item.trigger("click");
        item.get(0).scrollIntoView();
    } else {
        createChat(id);
    }
}

function participantSelectToGroup() {
    const id = $(this).attr("data-id");

    $(".group-creator .participants input").val("");
    $(".group-creator .participants .list").addClass("hidden");

    const exists = data.participantsToGroup.find(x => x === id) != null;
    if (exists) {
        return;
    }

    $(".group-creator .participants-list .splash").remove();

    data.participantsToGroup.push(id);

    const user = data.users.find(x => x.id === id);
    const { surname, name } = user;
    const item = $(`<div class="item" data-id="${id}" title="Кликните, чтобы убрать участника">${surname} ${name}</div>`);
    $(".group-creator .participants-list").append(item);
}

function resetChatControls() {
    data.editMessage = null;
    data.replyMessage = null;
    data.attachmentsToDelete.length = 0;
    data.attachments.length = 0;

    $("#content").val("");
    $(".chat .controls .content .attachments").empty().addClass("hidden");
    $(".chat .controls .content .reply-to").addClass("hidden");
    $("#cancel").addClass("hidden");
    $("#send")
        .text("Отправить")
        .off()
        .on("click", sendMessage);
}

function fileTypeClick() {
    const maxFiles = 10;
    const typesMap = new Map([["video", "video/mp4,video/ogg,video/webm"],
    ["audio", "audio/mp3,audio/ogg,audio/wav"], ["image", "image/*"]]);

    const type = $(this).attr("data-file-type");

    data.attachments.length = 0;

    const attachmentsSelect = () => {
        $("#selectFiles .select-files-type").addClass("hidden");

        const container = $(".chat .controls .content .attachments");
        container.find(".file:not(.attachment)").remove();

        if (data.editMessage != null && data.editMessage.attachments.length !== 0) {
            const typeToFileMap = new Map([["video", fileType.video],
            ["audio", fileType.audio], ["image", fileType.image]]);
            const allowFileType = typeToFileMap.get(type);

            if (data.editMessage.attachments[0].type !== allowFileType) {
                data.attachmentsToDelete = [...data.editMessage.attachments];

                container.find(".file.attachment").remove();
            }
        }

        if ($(".chat .controls .content .attachments .file").length === 0) {
            $(".chat .controls .content .attachments").addClass("hidden");
        }

        if ($("#files").get(0).files.length === 0)
            return;

        container.removeClass("hidden");

        const filesSize = data.editMessage == null ? maxFiles :
            maxFiles - (data.editMessage.attachments.length - data.attachmentsToDelete.length);
        const files = Array.from($("#files").get(0).files).slice(0, filesSize);

        for (let file of files) {
            const item = $(`<span class='file' title="${file.name}" data-name="${file.name}">
                        ${renderFileControlPanel()}</span>`);
            item.append(getFileControl(file));

            if (item.find("audio").length !== 0) {
                item.attr("data-state", "stop");
            }

            container.append(item);

            data.attachments.push(file);
        }
    }

    const setFileContent = (element, file) => {
        const reader = new FileReader();
        reader.onload = e => {
            const data = e.target.result;

            element.attr("src", data);

            reader.onload = null;
        };
        reader.readAsDataURL(file);
    };

    const getFileControl = file => {
        switch (type) {
            case "image":
                const img = $("<img />");
                setFileContent(img, file);

                return img;
            case "video":
                const video = $("<video autoplay muted></video>");
                setFileContent(video, file);

                return video;
            case "audio":
                const audio = $("<audio></audio>");
                setFileContent(audio, file);

                const ext = /\.([^\.]*)$/gi.exec(file.name)[1];
                const container = $(`<span class="icon">${ext}</span>`);
                container.append(audio);

                return container;
            default:
                throw new Error("Unsupported file type");
        }
    };

    $("#files")
        .off("change")
        .on("change", attachmentsSelect)
        .attr("accept", typesMap.get(type))
        .val("")
        .trigger("click");
}

function removeAttachment() {
    const item = $(this).closest(".file");
    const file = item.attr("data-name");
    const index = data.attachments.findIndex(x => x.name === file);

    data.attachments.splice(index, 1);

    item.remove();

    if ($(".chat .controls .content .attachments .file").length === 0) {
        $(".chat .controls .content .attachments").addClass("hidden");
    }
}

function prepareToDeleteAttachment() {
    const item = $(this).closest(".file");
    const file = item.attr("data-name");

    data.attachmentsToDelete.push(data.editMessage.attachments.find(x => x.name === file));

    item.remove();

    if ($(".chat .controls .content .attachments .file").length === 0) {
        $(".chat .controls .content .attachments").addClass("hidden");
    }
}

function renderFileControlPanel() {
    return `<span class="control-panel"> 
                        <svg viewBox="0 0 20 20" class="play">
                            <polygon points="2,2 16,10 2,18"/>
                        </svg>
                        <svg viewBox="0 0 20 20" class="stop">
                            <polygon points="2,2 18,2 18,18 2,18"/>
                        </svg>
                        <svg viewBox="0 0 20 20" class="delete">
                            <line x1="2" y1="18" x2="18" y2="2"></line>
                            <line x1="2" y1="2" x2="18" y2="18"></line>
                        </svg>
                    </span>`;
}

function playAudio() {
    const button = $(this);
    const item = button.closest(".file");

    item.attr("data-state", "play");

    const audio = item.find("audio");
    audio.get(0).play();
}

function stopAudio() {
    const button = $(this);
    const item = button.closest(".file");

    item.attr("data-state", "stop");

    const audio = item.find("audio");
    audio.get(0).pause();
}

function showMessageMenu(e) {
    const item = $(this).closest(".item");
    const messageId = item.attr("data-id");
    const container = $(".chat .messages");
    container
        .find(".item-menu")
        .remove();
    $(".chat-selector").remove();

    const menu = $(`<div class='item-menu' data-message="${messageId}"></div>`);
    menu.append("<div class='action reply'>Ответить</div>");
    menu.append("<div class='action forward'>Переслать</div>");

    if (item.hasClass("me") &&
        data.messages.find(x => x.id === messageId).forwarded == null) {
        menu.append("<div class='action edit'>Изменить</div>");
    }

    $(".chat .messages").append(menu);

    const { offsetHeight, offsetWidth } = menu.get(0);
    const { layerX, layerY } = e.originalEvent;
    const { scrollTop, scrollHeight, scrollWidth } = container.get(0);

    const top = layerY + scrollTop + offsetHeight <= scrollHeight ?
        layerY + scrollTop :
        layerY + scrollTop - offsetHeight;
    const left = layerX + offsetWidth <= scrollWidth ?
        layerX : layerX - offsetWidth;

    menu.css({
        top: `${top}px`,
        left: `${left}px`
    });

    return false;
}

function toEditMessage() {
    resetChatControls();

    const messageId = $(this).closest(".item-menu").attr("data-message");

    data.editMessage = data.messages.find(x => x.id === messageId);

    $("#cancel").removeClass("hidden");
    $("#send")
        .text("Изменить")
        .off()
        .on("click", editMessage);

    const { content, attachments } = data.editMessage;

    $("#content").val(content);

    if (attachments.length === 0)
        return;

    const setFileSource = (element, file) => element.attr("src", `api/files/${file}`);
    const getAttachmentControl = attachment => {
        switch (attachment.type) {
            case fileType.image:
                const img = $("<img />");
                setFileSource(img, attachment.name);

                return img;
            case fileType.video:
                const video = $("<video autoplay muted></video>");
                setFileSource(video, attachment.name);

                return video;
            case fileType.audio:
                const audio = $("<audio></audio>");
                setFileSource(audio, attachment.name);

                const ext = /\.([^\.]*)$/gi.exec(attachment.name)[1];
                const container = $(`<span class="icon">${ext}</span>`);
                container.append(audio);

                return container;
            default:
                throw new Error("Unsupported file type");
        }
    };

    const container = $(".chat .controls .content .attachments");
    container.removeClass("hidden");

    for (let attachment of attachments) {
        const item = $(`<span class='file attachment' title="${attachment.originalName}" data-name="${attachment.name}">
                        ${renderFileControlPanel()}</span>`);
        item.append(getAttachmentControl(attachment));

        if (item.find("audio").length !== 0) {
            item.attr("data-state", "stop");
        }

        container.append(item);
    }
}

function toReplyMessage() {
    resetChatControls();

    const messageId = $(this).closest(".item-menu").attr("data-message");

    data.replyMessage = data.messages.find(x => x.id === messageId);

    $("#cancel").removeClass("hidden");
    $("#send")
        .text("Ответить")
        .off()
        .on("click", sendMessage);
    $(".chat .controls .content .reply-to").removeClass("hidden");
    $(".chat .controls .content .reply-to .reply-content, .chat .controls .content .reply-to .files")
        .empty()
        .addClass("hidden");

    const { author: { surname, name }, content, attachments } = data.replyMessage;

    $(".chat .controls .content .reply-to .author").text(`${surname} ${name}`);
    if (content !== "") {
        $(".chat .controls .content .reply-to .reply-content")
            .text(content)
            .removeClass("hidden");
    }

    if (attachments.length === 0)
        return;

    const container = $(".chat .controls .content .reply-to .files");
    container.removeClass("hidden");

    attachments.forEach(attachment =>
        container.append(createAttachmentControl(attachment)));
}

function toForwardMessage(e) {
    const messageId = $(this).closest(".item-menu").attr("data-message");

    $(".chat-selector").remove();

    const chatSelector = $(`<div class="chat-selector" data-message="${messageId}"></div>`);
    $("body").append(chatSelector);

    chatSelector.append("<header>Выберите беседу</header>");

    data.conversations
        .filter(x => x.room !== data.room)
        .forEach(conversation => {
            const { room, participants, type, groupName } = conversation;
            const item = $(`<div class="room" data-room="${room}"></div>`);

            switch (type) {
                case conversationType.single:
                    const participant = participants.find(x => x.id !== data.user.id);

                    item.append(createUserIcon(participant));
                    item.append(`<div>${participant.surname} ${participant.name}</div>`);
                    break;
                case conversationType.group:
                    item.append(`<img src="assets/group-icon.png" class="group-icon" />`);
                    item.append(`<div>${groupName}</div>`);
                    break;
                default:
                    throw new Error("Unknown conversation type");
            }

            chatSelector.append(item);
        });

    const { offsetHeight, offsetWidth } = chatSelector.get(0);
    const { top: menuTop, left: menuLeft } = $(this).offset();
    const { offsetX, offsetY } = e.originalEvent;
    const { offsetHeight: bodyHeight, offsetWidth: bodyWidth } = $("body").get(0);

    const top = menuTop + offsetHeight + offsetY <= bodyHeight ?
        menuTop + offsetY :
        menuTop - (offsetHeight - offsetY);
    const left = menuLeft + offsetWidth + offsetX <= bodyWidth ?
        menuLeft + offsetX :
        menuLeft - (offsetWidth - offsetX);

    chatSelector.css({
        top: `${top}px`,
        left: `${left}px`
    });
}

async function replySelect() {
    const delay = 250;
    const scrollLag = -30;

    const id = $(this).attr("data-id");

    let item = $(`.chat .messages .item[data-id='${id}']`);

    const timeout = delay => new Promise((resolve, reject) => setTimeout(resolve, delay));

    while (item.length === 0) {
        let loadMore = $(".chat .messages .load-more-messages");
        if (loadMore.length === 0) {
            break;
        }

        loadMore.get(0).scrollIntoView();
        paging.force();

        do {
            await timeout(delay);

            loadMore = $(".chat .messages .load-more-messages");
            item = $(`.chat .messages .item[data-id='${id}']`);
        } while (item.length === 0 && loadMore.length === 0);
    }

    if (item.length === 0) {
        return;
    }

    item.get(0).scrollIntoView();
    $(".chat .messages").get(0).scrollBy(0, scrollLag);

    item.off("animationend")
        .removeClass("highlight")
        .one("animationend", () => item.removeClass("highlight"))
        .addClass("highlight");
}

async function conversationItemClick() {
    const item = $(this);
    if (item.hasClass("active")) {
        return;
    }

    resetChatControls();
    $(".room .splash").addClass("hidden");
    $(".room .chat").removeClass("hidden");
    $("#content").val("").off("input").on("input", throttle(userTyping, 2000));
    $(".conversations > .list .item.active").removeClass("active");
    $(".conversations > .list .item.creating").remove();
    $(".chat .messages").removeClass("group");

    data.room = item.attr("data-room");

    const conversation = data.conversations.find(x => x.room === data.room);

    switch (conversation.type) {
        case conversationType.single:
            const collaborator = conversation.participants.find(x => x.id !== data.user.id);
            setChatCollaborator(collaborator);
            break;
        case conversationType.group:
            setChatName(conversation);
            showGroupActions(conversation);
            $(".chat .messages").addClass("group");
            break;
        default:
            throw new Error("Unknown conversation type");
    }

    cancelHighlightConversation(item);
    clearTypingChatNotify();

    item.addClass("active");

    await loadMessages(data.room);
}

async function loadMessages(room) {
    const container = $(".chat .messages");
    container.empty();

    let response = await fetch(`api/conversation/messages/${room}?size=${PageSize}`);
    if (response.ok) {
        let { messages, nextUrl } = await response.json();

        data.messages = messages;

        await processDelivered(room, messages);
        await showMessages(messages, true);

        const firstUnread = $(".chat .messages .item.init.unread:eq(0)");
        if (firstUnread.length !== 0) {
            const unreadSplash = $("<div class='unread-splash'>Непрочитанные сообщения</div>");

            if (firstUnread.index() === 1) {
                $(".chat .messages .day-label:eq(0)").before(unreadSplash);
            }
            else {
                firstUnread.before(unreadSplash);
            }

            unreadSplash.get(0).scrollIntoView();
        } else {
            $(".chat .messages .item:last-child").get(0).scrollIntoView();
        }

        unreadWatcher.force();

        /* Если доступны еще записи, регистрируем коллбек дозагрузки сообщений, 
            вызываемый при прокрутке списка с сообщениями в начало */
        if (nextUrl != null) {
            $(".chat .messages").prepend("<div class='load-more-messages'></div>");

            async function loadMore() {
                $(".chat .messages .load-more-messages").remove();

                if (nextUrl == null) {
                    return;
                }

                const response = await fetch(nextUrl);
                if (response.ok) {
                    ({ messages, nextUrl } = await response.json());

                    if (messages.length === 0) {
                        return;
                    }

                    data.messages = [...messages, ...data.messages];

                    await processDelivered(room, messages);

                    /* Удерживаем список в позиции скролла на момент вызова коллбека,
                        иначе список, при добавлении записей, постоянно прокручивается в начало  */
                    const unreadSplashPad = $(".chat .messages .unread-splash").index() === 0 ?
                        $(".chat .messages .unread-splash").get(0).offsetHeight : 0;
                    const dayLabelPad = $(".chat .messages .day-label:eq(0)").get(0).offsetHeight;
                    const first = $(".chat .messages .item:eq(0)").get(0);

                    await showMessages(messages);

                    first.scrollIntoView();
                    $(".chat .messages").get(0).scrollBy(0, -(dayLabelPad + unreadSplashPad));

                    if (nextUrl != null) {
                        $(".chat .messages").prepend("<div class='load-more-messages'></div>");
                    }

                    paging.force();
                }
            }

            paging.register(".chat .messages .load-more-messages", loadMore);
            paging.force();
        }
    }
}

async function loadConversations() {
    const response = await fetch(`api/conversation/${data.user.id}`);
    if (!response.ok) {
        throw new Error("Can't load user's conversations");
    }

    data.conversations = await response.json();

    await socket.join(data.conversations.map(x => x.room));

    showConversations(data.conversations);
}

function createChat(userId) {
    $(".conversations > .list .item.creating").remove();

    data.room = null;
    data.messages = [];

    const participant = data.users.find(x => x.id === userId);
    const item = $(`<div class="item creating"></div>`);

    item.append(createUserIcon(participant));
    item.append(`<span>${participant.surname} ${participant.name}<span>`);

    $(".conversations > .list").prepend(item);

    resetChatControls();
    $(".room .splash").addClass("hidden");
    $(".room .chat").removeClass("hidden");
    $("#content").val("").off("input");
    $(".chat .messages").empty().removeClass("group");
    $(".conversations > .list .item.active").removeClass("active");
    $(".chat .messages")
        .append("<div class='splash'><span class='text'>Создайте беседу с вашим первым сообщением</span></div>");
    $("#send")
        .off()
        .on("click", async () => await sendCreateConversation(userId, item));

    clearTypingChatNotify();
    setChatCollaborator(participant);

    item.addClass("active");
}

async function createGroupConversation() {
    const validate = () => {
        let isValid = true;

        const name = $("#groupName").val().trim();
        if (name === "") {
            $("#groupName")
                .removeClass("invalid")
                .off("animationend")
                .on("animationend", () => $("#groupName").removeClass("invalid"))
                .addClass("invalid");

            isValid = false;
        }

        if (data.participantsToGroup.length === 0) {
            $(".group-creator .dialog .dialog-body .participants-list")
                .removeClass("invalid")
                .off("animationend")
                .on("animationend",
                    () => $(".group-creator .dialog .dialog-body .participants-list").removeClass("invalid"))
                .addClass("invalid");

            isValid = false;
        }

        return isValid;
    }

    if (!validate()) {
        return;
    }

    try {
        if ($(".group-creator").attr("data-processing") === true.toString()) {
            return;
        }

        $(".group-creator").attr("data-processing", true.toString());

        const name = $("#groupName").val().trim();
        const conversation = await socket.createGroup(data.participantsToGroup, name);
        data.conversations.push(conversation);

        data.room = conversation.room;

        resetChatControls();
        $(".room .splash").addClass("hidden");
        $(".room .chat").removeClass("hidden");
        $("#content").val("").off("input").on("input", throttle(userTyping, 2000));
        $(".conversations > .list .item.active").removeClass("active");
        $(".conversations > .list .item.creating").remove();
        $(".chat .messages").empty().addClass("group");

        const item = createConversationItem(conversation);
        item.addClass("active");

        $(".conversations > .list").prepend(item);

        setChatName(conversation);
        showGroupActions(conversation);
        clearTypingChatNotify();

        $(".group-creator").attr("data-processing", false.toString());
        $("#cancel-create-group").trigger("click");
    } catch {
        alert("Не удалось создать групповую беседу. Пожалуйста, повторите попытку позже");
        $(".group-creator").attr("data-processing", false.toString());
    }
}

async function sendCreateConversation(participant, item) {
    try {
        const content = $("#content").val().trim();
        if (content === "" && data.attachments.length === 0) {
            return;
        }

        if ($("#send").attr("data-processing") === true.toString()) {
            return;
        }

        $("#send").attr("data-processing", true.toString());

        const attachments = await saveAttachments();

        const conversation = await socket.create([participant], content, attachments);
        data.conversations.push(conversation);

        data.room = conversation.room;
        data.attachments.length = 0;

        const newItem = createConversationItem(conversation);
        newItem.addClass("active");

        item.replaceWith(newItem);

        $(".chat .messages .splash").remove();
        $(".chat .controls .content .attachments").empty().addClass("hidden");
        $("#send")
            .off()
            .on("click", sendMessage)
            .attr("data-processing", false.toString());
        $("#content")
            .val("")
            .off("input")
            .on("input", throttle(userTyping, 2000));
    } catch (e) {
        alert("Не удалось создать чат, пожалуйста повторите попытку позже");

        $("#send").attr("data-processing", false.toString());
    }
}

async function sendMessage() {
    try {
        const content = $("#content").val().trim();
        if (content === "" && data.attachments.length === 0) {
            return;
        }

        if ($("#send").attr("data-processing") === true.toString()) {
            return;
        }

        $("#send").attr("data-processing", true.toString());

        const attachments = await saveAttachments();

        await socket.send(data.room, content, attachments, data.replyMessage?.id);

        data.attachments.length = 0;

        resetChatControls();
        $("#send").attr("data-processing", false.toString());
    } catch (e) {
        alert("Не удалось отправить сообщение, пожалуйста повторите попытку позже");

        $("#send").attr("data-processing", false.toString());
    }
}

async function editMessage() {
    try {
        if (data.editMessage == null) {
            return;
        }

        const content = $("#content").val().trim();
        if ((content === "" &&
            data.attachments.length === 0 &&
            data.attachmentsToDelete.length === data.editMessage.attachments.length) ||
            (content === data.editMessage.content &&
                data.attachments.length === 0 &&
                data.attachmentsToDelete.length === 0)) {
            return;
        }

        if ($("#send").attr("data-processing") === true.toString()) {
            return;
        }

        $("#send").attr("data-processing", true.toString());

        const newAttachments = await saveAttachments();
        const editedAttachments = data.editMessage.attachments.filter(
            x => data.attachmentsToDelete.findIndex(y => y.name === x.name) === -1);

        await socket.edit(data.room, data.editMessage.id, content, [...editedAttachments, ...newAttachments]);
        await deleteFiles();

        resetChatControls();
        $("#send").attr("data-processing", false.toString());
    } catch (e) {
        alert("Не удалось изменить сообщение, пожалуйста повторите попытку позже");

        $("#send").attr("data-processing", false.toString());
    }
}

async function forwardMessage() {
    const messageId = $(this).closest(".chat-selector").attr("data-message");
    const room = $(this).attr("data-room");

    $(".chat-selector").remove();

    try {
        await socket.forward(data.room, messageId, room);

        const item = $(`.chat .messages .item[data-id='${messageId}']`);
        item.off("animationend")
            .removeClass("highlight")
            .one("animationend", () => item.removeClass("highlight"))
            .addClass("highlight");

    } catch (e) {
        alert("Не удалось отправить сообщение, пожалуйста повторите попытку позже");
    }
}

async function saveAttachments() {
    if (data.attachments.length === 0) {
        return [];
    }

    const formData = new FormData();
    let i = 0;

    data.attachments.forEach(file => formData.append(`file${++i}`, file));

    const response = await fetch("api/files?extendInfo=true", {
        method: "POST",
        body: formData
    });
    if (response.ok) {
        return await response.json();
    }

    return [];
}

async function deleteFiles() {
    if (data.attachmentsToDelete.length === 0) {
        return;
    }

    const files = data.attachmentsToDelete.map(x => x.name);

    await fetch("api/files", {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(files)
    });
}

async function leaveGroup() {
    try {
        await socket.leaveGroup(data.room, data.user.id);
    } catch (e) {
        alert("Не удалось покинуть группу");
    }
}

async function dropFromGroup() {
    try {
        const id = $(this).attr("data-id");

        await socket.leaveGroup(data.room, id);

        $(".group-participants-view-to-drop").off().remove();
    } catch (e) {
        alert("Не удалось удалить участника из группы");
    }
}

async function addToGroup() {
    try {
        const id = $(this).attr("data-id");
        if (data.conversations.find(x => x.room === data.room).participants.find(x => x.id === id) != null) {
            return;
        }

        $(".chat .group-actions .participants input").val("");
        $(".chat .group-actions .participants .list").addClass("hidden");

        await socket.joinToGroup(data.room, id);
    } catch (e) {
        alert("Не удалось добавить участника в группу");
    }
}

async function userTyping() {
    const isEmpty = $("#content").val().trim() === "";
    if (isEmpty) {
        return;
    }
    try {
        await socket.typing(data.room);
    } catch { }
}

async function processReaded(readed) {
    try {
        const { room, unreads } = await socket.readed(data.room, readed);

        const conversation = data.conversations.find(x => x.room === room);
        conversation.unreads = unreads;

        const item = $(`.conversations > .list .item[data-room='${room}']`);
        setConversationUnreads(item, unreads);

        if (data.room === room) {
            readed.forEach(x =>
                $(`.chat .messages .item[data-id='${x}']`).removeClass("unread processing"));

            const isUnreadedMore = $(".chat .messages .item.init.unread").length !== 0;
            if (!isUnreadedMore) {
                $(".chat .messages .unread-splash").remove();
            }
        }
    } catch { }
}

async function processDelivered(room, messages) {
    try {
        if (data.conversations.find(x => x.room === room).type === conversationType.group) {
            return;
        }

        const delivered = messages
            .filter(x => x.status === messageStatus.created && x.author.id !== data.user.id)
            .map(x => x.id);
        if (delivered.length === 0) {
            return;
        }

        await socket.delivered(room, delivered);
    } catch { }
}

async function onMessageReceived(e) {
    const message = e.data;
    const { room, author, type } = message;

    if (type === messageType.user) {
        await processDelivered(room, [message]);
    }

    if (data.room === room || isCreating(room)) {
        data.messages.push(message);

        $(".chat .messages .splash").remove();

        /* Если список с сообщениями прокручен вверх, то при добавлении сообщения
            не прокручиваем список к нему (юзер смотрит историю сообщений и не надо сбивать его)  */
        const isScroll = isChatScrollToNew();

        const item = createMessageItem(message);
        const addDayLabel = $(`.chat .messages .item[data-item-date='${item.attr("data-item-date")}']`).length === 0;

        await mediaLoaded(item, () => $(".chat .messages").append(item));

        if (addDayLabel) {
            item.before(createDateLabel(item.attr("data-item-date")));
        }

        if (isScroll) {
            item.get(0).scrollIntoView();
        }

        if (data.user.id !== author.id) {
            clearTypingChatNotify();
        }

        unreadWatcher.force();
    }

    const conversation = isCreating(room) ?
        $(".conversations > .list .item.creating") :
        $(`.conversations > .list .item[data-room='${room}']`);
    $(".conversations > .list").prepend(conversation);

    if (data.user.id !== author.id && type === messageType.user) {
        clearTypingConversationNotify(room);
    }

    showLastMessage(conversation, message);

    if (data.user.id !== author.id && data.room !== room) {
        highlightConversation(conversation);
    }

    if (data.user.id !== author.id && type === messageType.user) {
        const model = data.conversations.find(x => x.room === room);
        model.unreads++;

        setConversationUnreads(conversation, model.unreads);
    }
}

async function onChatCreated(e) {
    const conversation = e.data;
    const { room } = conversation;

    try {
        await socket.join([room]);

        data.conversations.push(conversation);

        const item = createConversationItem(conversation);

        $(".conversations > .list").prepend(item);

        highlightConversation(item);
    } catch (e) {
        alert("Ошибка, не удалось подключиться к новому чату. Перезагрузите страницу для доступа к новому чату");
    }
}

function onUserTyping() {
    const map = new Map();
    let chatTimeout = null;

    return function (e) {
        const { room, user } = e.data;

        clearTimeout(map.get(room));
        showTypingConversationNotify(room, user);

        map.set(room, setTimeout(() => clearTypingConversationNotify(room), 3000));

        if (data.room === room) {
            clearTimeout(chatTimeout);
            showTypingChatNotify(user);

            chatTimeout = setTimeout(clearTypingChatNotify, 3000);
        }
    }
}

function onUserStatus(e) {
    const { user, status } = e.data;
    if (data.user.id === user) {
        return;
    }

    const conversations = data.conversations
        .filter(x => x.participants.find(y => y.id === user) != null);

    for (let conversation of conversations) {
        for (let participant of conversation.participants) {
            if (participant.id === user) {
                participant.online = status;

                if (conversation.type === conversationType.single) {
                    const icon = $(`.conversations > .list .item[data-room='${conversation.room}']`)
                        .find(".user-icon .status")
                        .removeClass("online");

                    if (status === true.toString()) {
                        icon.addClass("online");
                    }
                }
            }
        }
    }

    if (data.room == null) {
        return;
    }

    const isUpdateChatCollaborator = data.conversations.find(x => x.room === data.room)
        .participants.find(x => x.id === user) != null;
    if (isUpdateChatCollaborator) {
        switch (data.conversations.find(x => x.room === data.room).type) {
            case conversationType.single:
                setChatCollaboratorStatus(status);
                break;
            case conversationType.group:
                renderGroupParticipants();
                break;
            default:
                throw new Error("Unknown conversation type");
        }
    }
}

function onMessagesStatus(e) {
    const { room, status, messages } = e.data;

    if (data.conversations.find(x => x.room === room).type === conversationType.group) {
        return;
    }

    if (data.room === room) {
        messages.forEach(x => setMessageStatus(x, status));
    }
}

async function onMessageEdit(e) {
    const message = e.data;
    const { room, author, unreadCount } = message;

    await processDelivered(room, [message]);

    if (data.room === room) {
        const messageIndex = data.messages.findIndex(x => x.id === message.id);
        if (messageIndex !== -1) {
            data.messages.splice(messageIndex, 1, message);
        }

        const existsMessage = $(`.chat .messages .item[data-id='${message.id}']`);
        if (existsMessage.length !== 0) {
            $(".chat .messages .splash").remove();

            const isScroll = $(".chat .messages .item:last-child").attr("data-id") === message.id &&
                isChatScrollToNew();
            const item = createMessageItem(message, existsMessage.hasClass("init"));

            await mediaLoaded(item, () => existsMessage.replaceWith(item));

            if (data.user.id !== author.id) {
                clearTypingChatNotify();
            }

            if (isScroll) {
                item.get(0).scrollIntoView();
            }

            unreadWatcher.force();
        }
    }

    const conversation = $(`.conversations > .list .item[data-room='${room}']`);
    $(".conversations > .list").prepend(conversation);

    if (data.user.id !== author.id) {
        clearTypingConversationNotify(room);
    }

    showLastMessage(conversation, message);

    if (data.user.id !== author.id && data.room !== room) {
        highlightConversation(conversation);
    }

    if (data.user.id !== author.id) {
        const model = data.conversations.find(x => x.room === room);
        model.unreads = unreadCount;

        setConversationUnreads(conversation, model.unreads);
    }
}

async function onGroupLeft(e) {
    try {
        const { room, userId } = e.data;

        if (data.user.id === userId) {
            await socket.leave(room);

            const index = data.conversations.findIndex(x => x.room === room);
            data.conversations.splice(index, 1);

            const item = $(`.conversations > .list .item[data-room='${room}']`);
            item.remove();

            if (data.room === room) {
                data.room = null;

                $(".room .splash").removeClass("hidden");
                $(".room .chat").addClass("hidden");
            }
        } else {
            const { participants } = data.conversations.find(x => x.room === room);
            const index = participants.findIndex(x => x.id === userId);
            participants.splice(index, 1);

            const item = $(`.conversations > .list .item[data-room='${room}']`);
            const participantsPostfix = participants.length > 1 ? "участников" : "участник";
            item.find(".participants-count").text(`${participants.length} ${participantsPostfix}`);

            if (data.room === room) {
                $(".chat .group-status .group-participants").text(`${participants.length} участников`);
                $(".group-participants-view-to-drop").off().remove();
                $(".group-participants-view").remove();
            }
        }
    } catch (e) {
        alert("Не удалось покинуть группу");
    }
}

async function onGroupJoin(e) {
    const { room, participant } = e.data;

    const { participants } = data.conversations.find(x => x.room === room);
    participants.push(participant);

    const item = $(`.conversations > .list .item[data-room='${room}']`);
    item.find(".participants-count").text(`${participants.length} участников`);

    if (data.room === room) {
        const participantsPostfix = participants.length > 1 ? "участников" : "участник";
        $(".chat .group-status .group-participants").text(`${participants.length} ${participantsPostfix}`);
        $(".group-participants-view-to-drop").off().remove();
        $(".group-participants-view").remove();
    }
}

function isCreating(room) {
    return $(`.conversations > .list .item[data-room='${room}']`).length === 0;
}

function showLastMessage(conversation, message) {
    const { type, content, created, edited, author, attachments, isEdited } = message;
    if (type === messageType.system) {
        return;
    }

    const text = content == null || content.trim() === "" ?
        attachments.length !== 0 ? "<i>Файлы</i>" : "" : content;
    const user = data.user.id === author.id ? "Вы: " : `${author.name}: `;
    const editedLabel = isEdited ? "<i>(изменено) </i>" : "";
    conversation.find(".last-message .content").html(`${editedLabel}${user}${text}`);

    setMessageDate(conversation, !isEdited ? Date.parse(created) : Date.parse(edited));
}

async function showMessages(messages, init = false) {
    const container = $(".chat .messages");
    container.find(".day-label:eq(0)").remove();

    for (let message of messages) {
        const item = createMessageItem(message, init);

        await mediaLoaded(item, () => container.prepend(item));

        const prev = $(".chat .messages .item:eq(1)");
        if (prev.length !== 0 && prev.attr("data-item-date") !== item.attr("data-item-date")) {
            item.after(createDateLabel(prev.attr("data-item-date")));
        }
    }

    const first = $(".chat .messages .item:eq(0)");
    first.before(createDateLabel(first.attr("data-item-date")));
}

function showConversations(conversations) {
    const container = $(".conversations > .list");
    container.empty();

    conversations.forEach(x => container.append(createConversationItem(x)));
}

function showTypingConversationNotify(room, user) {
    const conversation = $(`.conversations > .list .item[data-room='${room}']`);
    conversation
        .find(".data .typing-notify")
        .text(`${user.name} печатает...`)
        .addClass("show");
}

function showGroupParticipants() {
    const button = $(this);
    const { top, left } = button.offset();
    const container = $("<div class='group-participants-view'></div>");

    $("body").append(container);

    container.css({
        top: `${top}px`,
        left: `${left}px`
    });

    renderGroupParticipants();
}

function showGroupActions(conversation) {
    $("#leaveGroup, #dropFromGroup, .chat .group-actions .participants").addClass("hidden");

    const { groupAdmin, type } = conversation;

    if (type !== conversationType.group) {
        return;
    }

    const amAdmin = data.user.id === groupAdmin;
    if (amAdmin) {
        $("#dropFromGroup, .chat .group-actions .participants").removeClass("hidden");
    } else {
        $("#leaveGroup").removeClass("hidden");
    }
}

function renderGroupParticipants() {
    const container = $(".group-participants-view");
    if (container.length === 0) {
        return;
    }

    container.empty();

    const { participants: source } = data.conversations.find(x => x.room === data.room);
    const participants = [...source];

    participants.sort((x, y) => {
        if (x.online === true.toString() && y.online === true.toString()) {
            return 0;
        } else if (x.online === true.toString()) {
            return -1;
        } else if (y.online === true.toString()) {
            return 1;
        } else {
            return Number(y.online) - Number(x.online);
        }
    });

    for (let participant of participants) {
        const { surname, name, online } = participant;
        const item = $("<div class='item'></div>");
        item.append(createUserIcon(participant));

        const value = online != null ?
            online === true.toString() ?
                "online" :
                `был(а) ${formatDate(new Date(Number(online)))}`
            : "offline";
        const onlineClass = online === true.toString() ? "online" : "";

        item.append(`<div class="data">
                        <div>${surname} ${name}</div>
                        <div class="status ${onlineClass}">${value}</div>
                    </data>`);

        container.append(item);
    }
}

function prepareToDrop() {
    const button = $(this);
    const { top, left } = button.offset();
    const container = $("<div class='group-participants-view-to-drop'></div>");

    $("body").append(container);

    container.css({
        top: `${top}px`,
        left: `${left}px`
    });

    container.on("click", ".item", dropFromGroup);

    const { participants, groupAdmin } = data.conversations.find(x => x.room === data.room);
    for (let participant of participants) {
        const { surname, name, id } = participant;

        if (id === groupAdmin) {
            continue;
        }

        const item = $(`<div class="item" data-id="${id}"></div>`);

        item.append(createUserIcon(participant));
        item.append(`<div class="data">${surname} ${name}</div>`);

        container.append(item);
    }
}

function clearTypingConversationNotify(room) {
    const conversation = $(`.conversations > .list .item[data-room='${room}']`);
    conversation
        .find(".data .typing-notify")
        .removeClass("show");
}

function showTypingChatNotify(user) {
    $(".chat .controls .typing-notify")
        .text(`${user.name} печатает...`)
        .addClass("show");
}

function clearTypingChatNotify() {
    $(".chat .controls .typing-notify").removeClass("show");
}

function setChatCollaborator(collaborator) {
    $(".chat > .status").removeClass("hidden");
    $(".chat .group-status").addClass("hidden");

    $(".chat > .status .collaborator").text(`${collaborator.surname} ${collaborator.name}`);

    setChatCollaboratorStatus(collaborator.online);
}

function setChatCollaboratorStatus(status) {
    const value = status != null ?
        status === true.toString() ?
            "online" :
            `был(а) ${formatDate(new Date(Number(status)))}`
        : "offline";

    $(".chat > .status .value")
        .removeClass("online")
        .text(value);

    if (status === true.toString()) {
        $(".chat > .status .value").addClass("online");
    }
}

function setChatName(conversation) {
    const { participants, groupName } = conversation;

    $(".chat > .status").addClass("hidden");
    $(".chat .group-status").removeClass("hidden");

    $(".chat .group-status .name").text(groupName);
    $(".chat .group-status .group-participants").text(`${participants.length} участников`);
}

function createConversationItem(conversation) {
    const { room, participants, lastMessage, unreads,
        type, groupName } = conversation;
    const item = $(`<div class="item" data-room="${room}"></div>`);
    const content = $("<div class='data'></div>");

    switch (type) {
        case conversationType.single:
            const participant = participants.find(x => x.id !== data.user.id);
            item.append(createUserIcon(participant));

            content.append(`<div>${participant.surname} ${participant.name}</div>`);
            break;
        case conversationType.group:
            item.append(`<img src="assets/group-icon.png" class="group-icon" />`);

            const participantsPostfix = participants.length > 1 ? "участников" : "участник";
            content.append(`<div>${groupName}<div class="participants-count">${participants.length} ${participantsPostfix}</div></div>`);
            break;
        default:
            throw new Error("Unknown conversation type");
    }

    content.append(`<div class='last-message'><div class='content'></div>
                <div class='time' data-format='conversation'></div><div class='typing-notify'></div></div>`);

    item.append(content);

    showLastMessage(item, lastMessage);
    setConversationUnreads(item, unreads);

    return item;
}

function createUserIcon(user) {
    const { surname, name, online } = user;

    return `<span class="user-icon">${surname[0].toLocaleUpperCase()}${name[0].toLocaleUpperCase()}
            <span class="status ${(online === true.toString() ? "online" : "")}"></span><span>`;
}

function createMessageItem(message, init = false) {
    const { type } = message;

    function createUserMessage(message) {
        const { author, created, edited, content, id, unread, replyTo,
            status, attachments, isEdited, forwarded } = message;
        const item = $(`<div class="item ${(data.user.id === author.id ?
            "me" : "")} ${(init ? "init" : "")}" data-id="${id}"></div>`);

        item.append(createUserIcon(author));

        const body = $("<div class='content'></div>");
        body.append(`<div class="text">${content}
                    <div class="attachments hidden"></div>
                    <div class="status" data-value="${status}">
                        <svg viewBox="0 0 34 20">
                            <polyline points="2,6 10,18 24,2"></polyline>
                            <polyline points="10,6 18,18 32,2" class="second"></polyline>
                        </svg>
                    </div></div>`);
        body.append(`<div class="time" data-format="message"></div>`);

        item.append(body);

        if (isEdited) {
            body.find(".time").wrap("<div class='edit-label'>изменено: </div>");
        }

        renderForwarded(item, forwarded);
        renderReplyTo(item, replyTo);
        renderAttachments(item, attachments);
        setMessageDate(item, !isEdited ? Date.parse(created) : Date.parse(edited));
        setItemDate(item, created);
        setUnread(item, unread);

        return item;
    }

    function createSystemMessage(message) {
        const { created, content, id, unread } = message;
        const item = $(`<div class="item system ${(init ? "init" : "")}" data-id="${id}"></div>`);

        item.append(`<div class="text">${content}</div>`);
        item.append(`<div class="time" data-format="message"></div>`);

        setMessageDate(item, Date.parse(created));
        setItemDate(item, created);
        setUnread(item, unread);

        return item;
    }

    function setItemDate(item, dateString) {
        const pad = value => String(value).padStart(2, "0");
        const date = new Date(Date.parse(dateString));

        item.attr("data-item-date",
            `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
    }

    function setUnread(item, unread) {
        if (unread == null || unread.length === 0) {
            return;
        }

        if (unread.find(x => x === data.user.id) != null) {
            item.addClass("unread");
        }
    }

    function renderAttachments(item, messageAttachments) {
        const attachments = [...messageAttachments];

        if (attachments.length === 0) {
            return;
        }

        const container = item.find(".attachments");
        container.removeClass("hidden");

        const getAttachmentControl = attachment => {
            switch (attachment.type) {
                case fileType.image:
                    return `<a href="api/files/${attachment.name}" target="_blank"><img src="api/files/${attachment.name}" title="${attachment.originalName}" /></a>`;
                case fileType.video:
                    return `<video src="api/files/${attachment.name}" title="${attachment.originalName}" controls></video>`;
                case fileType.audio:
                    return `<div>
                                <div class="track-name" title="${attachment.originalName}">${attachment.originalName}</div>
                                <audio src="api/files/${attachment.name}" controls></audio></div>`;
                default:
                    return "";
            }
        };

        switch (attachments[0].type) {
            case fileType.image:
            case fileType.video:
                if (attachments.length % 2 === 1) {
                    container.append("<div class='first'></div>");
                }

                container.append(`<div class="columns">
                                <div class="odd"></div>
                                <div class="even"></div>
                            </div>`);

                if (attachments.length % 2 === 1) {
                    container.find(".first").append(getAttachmentControl(attachments[0]));

                    attachments.splice(0, 1);
                }

                for (let i = 0; i + 1 <= attachments.length; i++) {
                    const column = i % 2 === 0 ? "odd" : "even";
                    const attachment = attachments[i];

                    container.find(`.columns .${column}`).append(getAttachmentControl(attachment));
                }
                break;
            case fileType.audio:
                attachments.forEach(attachment => container.append(getAttachmentControl(attachment)));
                break;
            default:
                break;
        }
    }

    function renderReplyTo(item, replyTo) {
        if (replyTo == null) {
            return;
        }

        const { id, author, content, attachments } = replyTo;
        const container = item.find(".content .text");
        const replyToBody = $(`<div class="reply-to" data-id="${id}">
                    <div class="reply-author">${author}</div></div>`);

        if (content !== "") {
            replyToBody.append(`<div class="reply-content">${content}</div>`);
        }

        if (attachments != null && attachments.length !== 0) {
            const replyAttachements = $("<div class='reply-attachments'></div>");
            replyToBody.append(replyAttachements);

            attachments.forEach(attachment =>
                replyAttachements.append(createAttachmentControl(attachment)));
        }

        container.prepend(replyToBody);
    }

    function renderForwarded(item, forwarded) {
        if (forwarded == null) {
            return;
        }

        item.find(".content .text")
            .prepend(`<div class="forwarded">Переслано от: ${forwarded}</div>`);
    }

    switch (type) {
        case messageType.user:
            return createUserMessage(message);
        case messageType.system:
            return createSystemMessage(message);
        default:
            return null;
    }
}

function createDateLabel(dateString) {
    const date = new Date(Date.parse(dateString));
    let text = null;

    if (isToday(date)) {
        text = "Сегодня";
    }
    else if (isYesterday(date)) {
        text = "Вчера";
    }
    else {
        text = `${date.toLocaleDateString("ru", { weekday: "long" })} ${date.toLocaleDateString("ru")}`;
    }

    return $(`<div class="day-label" >${text}</div>`);
}

function createAttachmentControl(attachment) {
    const setFileSource = (element, file) => element.attr("src", `api/files/${file}`);
    const getAttachmentControl = attachment => {
        switch (attachment.type) {
            case fileType.image:
                const img = $("<img />");
                setFileSource(img, attachment.name);

                return img;
            case fileType.video:
                const video = $("<video autoplay muted></video>");
                setFileSource(video, attachment.name);

                return video;
            case fileType.audio:
                const ext = /\.([^\.]*)$/gi.exec(attachment.name)[1];
                const container = $(`<span class="icon">${ext}</span>`);

                return container;
            default:
                throw new Error("Unsupported file type");
        }
    };

    const item = $(`<span class='file' title="${attachment.originalName}"></span>`);
    item.append(getAttachmentControl(attachment));

    return item;
};

function mediaLoaded(item, domFunc) {
    return new Promise((resolve, reject) => {
        const images = item.find("img");
        const videos = item.find("video");
        const audios = item.find("audio");

        let count = images.length + videos.length + audios.length;

        const onload = (element, onevent = "onload") => element[onevent] = () => {
            element[onevent] = null;
            count--;

            if (count === 0) {
                resolve();
            }
        };

        images.each((i, image) => onload(image));
        videos.each((i, video) => onload(video, "onloadedmetadata"));
        audios.each((i, audio) => onload(audio, "onloadedmetadata"));

        domFunc();

        if (images.length + videos.length + audios.length === 0) {
            resolve();
        }
    });
}

function highlightConversation(item) {
    item.one("animationend", () => item.removeClass("highlight"))
        .addClass("highlight");
}

function cancelHighlightConversation(item) {
    item.off("animationend")
        .removeClass("highlight");
}

/* Смотрим прокручен ли список в конец, используется для
    проверки необходимости прокрутки списка к вновь добавленному сообщению  */
function isChatScrollToNew() {
    const list = $(".chat .messages").get(0);
    const { scrollTop, scrollHeight, clientHeight } = list;
    const lag = 60;

    return scrollHeight - (scrollTop + clientHeight) < lag;
}

function setMessageDate(item, timestamp) {
    const now = Date.now();
    const diff = Math.round((now - timestamp) / 1000);
    const element = item.hasClass("time") ? item : item.find(".time");

    if (diff < 30) {
        element.addClass("pretty").text("только что").attr("data-time", timestamp);
    }
    else if (diff >= 30 && diff < 90) {
        element.addClass("pretty").text("минуту назад").attr("data-time", timestamp);
    }
    else if (diff >= 90 && diff < 150) {
        element.addClass("pretty").text("2 минуты назад").attr("data-time", timestamp);
    }
    else if (diff >= 150 && diff < 210) {
        element.addClass("pretty").text("3 минуты назад").attr("data-time", timestamp);
    }
    else if (diff >= 210 && diff < 270) {
        element.addClass("pretty").text("4 минуты назад").attr("data-time", timestamp);
    }
    else if (diff >= 270 && diff < 330) {
        element.addClass("pretty").text("5 минут назад").attr("data-time", timestamp);
    }
    else {
        element.removeClass("pretty").removeAttr("data-time");

        const timeOptions = {
            hour: "numeric",
            minute: "numeric",
            second: "numeric"
        };

        const format = element.attr("data-format");
        switch (format) {
            case "message":
                element.text(new Date(timestamp).toLocaleTimeString("ru", timeOptions));
                break;
            case "conversation":
                element.text(formatDate(new Date(timestamp)));
                break;
            default:
                throw new Error("Unknown time format");
        }
    }
}

function setConversationUnreads(item, unreads) {
    item.find(".unreads").remove();

    if (unreads == null || unreads === 0) {
        return;
    }

    item.append(`<span class="unreads">${unreads}</span>`);
}

function setMessageStatus(itemId, status) {
    const item = $(`.chat .messages .item[data-id='${itemId}']`);
    if (item.length === 0) {
        return;
    }

    item.find(".status").attr("data-value", status);
}

function formatDate(date) {
    const dateOptions = {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
    };
    const timeOptions = {
        hour: "numeric",
        minute: "numeric",
        second: "numeric"
    };

    if (isToday(date)) {
        return date.toLocaleTimeString("ru", timeOptions);
    }
    else if (isYesterday(date)) {
        return `вчера, ${date.toLocaleTimeString("ru", timeOptions)}`;
    }
    else {
        return date.toLocaleDateString("ru", dateOptions);
    }
}

function isToday(date) {
    const now = new Date();

    return now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() &&
        now.getDate() === date.getDate();
}

function isYesterday(date) {
    const now = new Date();
    now.setDate(now.getDate() - 1);

    return now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth() &&
        now.getDate() === date.getDate();
}

class MessagesPaging {
    #dataMap = new Map();
    #list = null;

    constructor(list) {
        this.#list = list;

        this.#list.addEventListener("scroll", this.#checkHits.bind(this));
        window.onresize = this.#checkHits.bind(this);
    }

    register(selector, callback) {
        this.#dataMap.set(selector, callback);
    }

    force() {
        this.#checkHits();
    }

    #checkHits() {
        for (let [selector, callback] of this.#dataMap.entries()) {
            const element = $(selector);
            if (element.length === 0) {
                continue;
            }

            const { offsetHeight } = element.get(0);
            const { top } = element.position();

            if (top + offsetHeight >= offsetHeight / 2) {
                callback();
            }
        }
    }
}

class UnreadWatcher {
    #list = null;
    #callback = null;
    #lag = 20;
    #readed = [];
    #invoke = null;

    constructor(list, callback) {
        this.#list = list;
        this.#callback = callback;
        this.#invoke = debounce(this.#call.bind(this), 750);

        this.#list.addEventListener("scroll", this.#checkHits.bind(this));
        window.onresize = this.#checkHits.bind(this);
    }

    force() {
        this.#checkHits();
    }

    #checkHits() {
        const { offsetHeight: listHeight } = this.#list;

        const unreads = $(this.#list).find(".unread:not(.processing)");
        unreads.each((i, element) => {
            const { offsetHeight: unreadHeight } = element;

            element = $(element);
            const { top } = element.position();

            if (top > -(this.#lag) && (top + unreadHeight < listHeight + this.#lag ||
                (unreadHeight >= listHeight && top + unreadHeight >= listHeight))) {
                element.addClass("processing");

                this.#readed.push(element.attr("data-id"));
            }
        });

        this.#invoke();
    }

    #call() {
        const readed = [...this.#readed];
        this.#readed.length = 0;

        if (readed.length === 0) {
            return;
        }

        this.#callback(readed);
    }
}

export default init;