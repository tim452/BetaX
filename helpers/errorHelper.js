function handleError(e, ctx) {
    const props = Object.keys(e.errors);
    const models = [];

    for (let field of props) {
        const message = e.errors[field].message;

        models.push({ field, message });
    }

    ctx.body = models;
    ctx.status = 400;

    console.error(e);
}

export default handleError;