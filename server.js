import Koa from "koa";
import Router from "koa-router";
import authorize from "./filters/authorize.js";
import forbid from "./filters/forbid.js";
import faviconMiddleware from "./middleware/favicon.js";
import staticMiddleware from "./middleware/static.js";
import loggerMiddleware from "./middleware/logger.js";
import errorsMiddleware from "./middleware/errors.js";
import sessionMiddleware from "./middleware/session.js";
import bodyParserMiddleware from "./middleware/bodyParser.js";
import passportMiddleware from "./middleware/passport.js";
import registrationHandler from "./routes/registrationRoutes.js";
import authHandler from "./routes/authRoutes.js";
import handleStatic from "./routes/staticRoutes.js";
import filesHandler from "./routes/filesRoutes.js";
import userHandler from "./routes/userRoutes.js";
import conversationHandler from "./routes/conversationRoutes.js";

const app = new Koa();

faviconMiddleware(app);
staticMiddleware(app);
loggerMiddleware(app);
errorsMiddleware(app);
sessionMiddleware(app);
bodyParserMiddleware(app);
passportMiddleware(app);

const registrationRouter = new Router({
    prefix: "/api/registration"
});
registrationRouter
    .post("/", registrationHandler.registerUser.bind(registrationHandler))
    .get("/email/:email", registrationHandler.isEmailUnique.bind(registrationHandler));

const authRouter = new Router({
    prefix: "/api/auth"
});
authRouter
    .post("/", authHandler.login.bind(authHandler))
    .get("/", authHandler.logout.bind(authHandler))
    .get("/info", authHandler.info.bind(authHandler));

const staticRouter = new Router();
staticRouter
    .get("/", authorize(true), handleStatic("index.html"))
    .get("/registration", handleStatic("registration.html"))
    .get("/login", handleStatic("login.html"))
    .get("/index.html", forbid)
    .get("/registration.html", forbid)
    .get("/login.html", forbid);

const filesRouter = new Router({
    prefix: "/api/files"
});
filesRouter
    .post("/", authorize(), filesHandler.upload.bind(filesHandler))
    .get("/:file", authorize(), filesHandler.send.bind(filesHandler))
    .delete("/", authorize(), filesHandler.delete.bind(filesHandler));

const userRouter = new Router({
    prefix: "/api/user"
});
userRouter
    .get("/search/:pattern", authorize(), userHandler.find.bind(userHandler));

const conversationRouter = new Router({
    prefix: "/api/conversation"
});
conversationRouter
    .get("/:id", authorize(), conversationHandler.getByUser.bind(conversationHandler))
    .get("/messages/:room", authorize(), conversationHandler.getMessages.bind(conversationHandler));

app.use(registrationRouter.routes());
app.use(authRouter.routes());
app.use(staticRouter.routes());
app.use(filesRouter.routes());
app.use(userRouter.routes());
app.use(conversationRouter.routes());

export default app;
