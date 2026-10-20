import busboy from "busboy";
import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import send from "koa-send";
import { fileType } from "../models/File.js";

const fileTypeMap = new Map([["image", fileType.image], ["video", fileType.video], ["audio", fileType.audio]]);

class FilesRoutes {
    async upload(ctx) {
        try {
            let { extendInfo } = ctx.query;

            extendInfo = extendInfo != null && extendInfo.trim().toLocaleLowerCase() === true.toString().toLocaleLowerCase() ?
                true : false;

            const files = await new Promise((resolve, reject) => {
                const bb = busboy({ headers: ctx.req.headers, defParamCharset: "utf8" });
                const uploaded = [];

                bb.on("file", (name, file, info) => {
                    const { filename, mimeType } = info;
                    
                    if (this.#mimeTypeGuard(mimeType)) {
                        const uploadFile = `${uuid()}${path.extname(filename)}`;
                        const saveTo = path.join(path.resolve("uploads"), uploadFile);
                        const ws = fs.createWriteStream(saveTo, { flags: "wx" });

                        file.pipe(ws);

                        if (extendInfo) {
                            file.on("close", () => uploaded.push({
                                originalName: filename,
                                name: uploadFile,
                                type: this.#getFileType(mimeType)
                            }));
                        } else {
                            file.on("close", () => uploaded.push(uploadFile));
                        }

                        ws.on("error", err => {
                            console.error(err);

                            uploaded.forEach(file => this.#unlink(file));

                            reject();
                        });
                    } else
                        file.resume();
                });
                bb.on("close", () => resolve(uploaded));

                ctx.req.pipe(bb);
            });

            ctx.body = files;
            ctx.status = 201;
        } catch(e) {
            ctx.status = 500;
        }
    }

    async send(ctx) {
        const file = ctx.params.file;
        const opts = { root: path.resolve("uploads") };

        ctx.res.setHeader("accept-ranges", "bytes");

        await send(ctx, `/${file}`, opts);
    }

    delete(ctx) {
        const files = ctx.request.body;

        files.forEach(file => this.#unlink(file));

        ctx.status = 200;
    }

    #unlink = (file) => fs.promises
        .unlink(path.join(path.resolve("uploads"), file))
        .catch(console.error);

    #mimeTypeGuard(mime) {
        const type = mime.match(/^[^/]*/gi)[0];

        if (["image", "video", "audio"].includes(type)) {
            return true;
        }

        return false;
    }

    #getFileType(mime) {
        const type = mime.match(/^[^/]*/gi)[0];

        if (["image", "video", "audio"].includes(type)) {
            return fileTypeMap.get(type);
        }

        return -1;
    }
}

export default new FilesRoutes();