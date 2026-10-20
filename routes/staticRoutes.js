import send from "koa-send";
import { resolve } from "path";

function handleStatic(file) {
    return async function (ctx) {
        const opts = { root: resolve("public") };
        const path = `/${file}`;

        await send(ctx, path, opts);
    };
}

export default handleStatic;