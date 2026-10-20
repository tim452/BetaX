const LoginPath = "/login";
const UnauthorizedCode = 401;

function authorize(redirect = false) {
    return async (ctx, next) => {
        if (!ctx.isAuthenticated()) {
            deny(ctx, UnauthorizedCode, redirect);

            return;
        }

        await next();
    };
}

function deny(ctx, status, redirect) {
    if (!redirect) 
        ctx.status = status;
    else 
        ctx.redirect(LoginPath);
}

export default authorize;