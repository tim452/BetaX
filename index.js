import app from "./server.js";
import config from "config";
import chat from "./libs/chat.js";

const server = app.listen(config.get("server.port"), config.get("server.host"), () => {
    console.log(`BetaX.Chat is running on http://${config.get("server.host")}:${config.get("server.port")}`);
});

chat.listen(server);