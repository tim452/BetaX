import session from "koa-session";
import store from "../libs/sessionStore.js";

export default app => app.use(session({
  signed: false,
  store
}, app));
