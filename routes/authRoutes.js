import passport from "../libs/passport/index.js";

class AuthRoutes {
    async login(ctx, next) {
        await passport.authenticate("local", async function (err, user) {
            if (err != null) 
                throw err;

            if (user != null) {
                await ctx.login(user);

                ctx.status = 200;
            } else {
                ctx.status = 401;
            }
        })(ctx, next);
    }

    async logout(ctx) {
        await ctx.logout();
        ctx.redirect("/");
    }

    info(ctx) {
        if (ctx.state.user == null) 
            ctx.body = "null";
        else 
            ctx.body = ctx.state.user.toModel();
        
        ctx.status = 200;
    }
}

export default new AuthRoutes();