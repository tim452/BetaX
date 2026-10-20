import LocalStrategy from "passport-local";
import { User } from "../../../models/User.js";

export default new LocalStrategy(
    {
        usernameField: "email",
        passwordField: "password"
    },
    async function (email, password, done) {
        try {
            const user = await User.findOne({ email });

            if (user == null || !user.checkPassword(password)) {
                return done(null, false);
            }
            
            return done(null, user);
        } catch (err) {
            return done(err);
        }
    }
);
