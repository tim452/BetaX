import mongooseStore from "koa-session-mongoose";
import mongoose from "../libs/mongoose.js";

export default mongooseStore.create({
    name: "Session",
    expires: 3600 * 24,
    connection: mongoose
});