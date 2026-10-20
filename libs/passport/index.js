import passport from "koa-passport";
import { User } from "../../models/User.js";
import localStrategy from "./strategies/local.js";

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user); 
    } catch (err) {
        done(err, null);
    }
     
});

passport.use(localStrategy);

export default passport;
