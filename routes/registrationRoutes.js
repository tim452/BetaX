import pck from "lodash";
import handleError from "../helpers/errorHelper.js";
import { User } from "../models/User.js";

const { pick } = pck; 
const EmailPattern = /([a-z0-9._-]+@[a-z0-9._-]+\.[a-z0-9._-]+)/ig;

const userFields = ["name", "surname", "email", "password"];

class RegistrationRoutes {

    async registerUser(ctx) {
        const user = pick(ctx.request.body, userFields);

        try {
            await User.create(user);

            ctx.status = 200;
        } catch (e) {
            handleError(e, ctx);
        }
    }

    async isEmailUnique(ctx) {
        const email = ctx.params.email;

        if (!email.match(EmailPattern)) {
            ctx.body = [{
                field: "email",
                message: "Укажите, пожалуйста, корректный email"
            }];
            ctx.status = 400;

            return;
        }
        
        const user = await User.findOne({ email });
        const isUnique = user == null;

        ctx.body = { isUnique };
        ctx.status = 200;
    }
}

export default new RegistrationRoutes();