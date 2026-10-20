function init() {
    $("#login").on("click", login);
}

function validate() {
    let isValid = true;

    const loginFields = ["email", "password"];
    for (let field of loginFields) {
        const input = $(`#${field}`);
        const value = input.val().trim();

        if (value === "") {
            isValid = false;

            input.off("animationend")
                .removeClass("invalid")
                .one("animationend", () => input.removeClass("invalid"))
                .addClass("invalid");
        }
    }

    return isValid;
}

async function login(e) {
    e.preventDefault();

    $(".error").addClass("hidden");

    if (!validate())
        return;

    if ($(this).attr("data-processing") === true.toString())
        return;

    $(this).attr("data-processing", true);

    const buffer = new Map();
    const loginFields = ["email", "password"];
    loginFields.forEach(field => buffer.set(field, $(`#${field}`).val().trim()));

    const model = Object.fromEntries(buffer.entries());

    const response = await fetch("api/auth", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(model),
    });
    if (response.ok) {
        window.location = "/";
    } else { 
        $(".error").removeClass("hidden");
    }

    $(this).attr("data-processing", false);
}

export default init;