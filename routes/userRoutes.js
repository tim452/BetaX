import { User } from "../models/User.js";

class UserRoutes {

    async find(ctx) {
        const { pattern } = ctx.params;

        if (pattern == null || pattern.trim().length < 2) {
            ctx.body = [];
            ctx.status = 200;

            return;
        }

        const regex = new RegExp(`(^|\\s|-)${pattern}`, "gi");
        const users = await User.find({
            "$or": [{ name: { "$regex": regex } },
                { surname: { "$regex": regex } }]
        });

        ctx.body = users.map(x => x.toModel());
        ctx.status = 200;
    }
}

export default new UserRoutes();