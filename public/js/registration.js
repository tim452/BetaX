const EmailPattern = /^[a-z0-9._-]+@[a-z0-9._-]+\.[a-z0-9._-]+$/ig;
const PasswordPattern = /^(?=.*([a-zа-я]))(?=.*(\d))(?=.*([^a-zа-я0-9]))(?!.*(\s)).{8,}/ig;
const NamePattern = /^(?!.*(\d))(?!.*[№._`~!@#$%^&*()\-+={\[\]}\\|:;"'<,>?/]).{2,}/ig;
const SurnamePattern = /^(?=[a-zа-я])(?!.*-+.*-+)(?!.*(\d))(?!.*[№._`~!@#$%^&*()+={\[\]}\\|:;"'<,>?/]).{2,}/ig;

const regexMap = new Map([["name", NamePattern], ["surname", SurnamePattern], ["email", EmailPattern], ["password", PasswordPattern]]);
const invalidStates = new Set();

function init() {
    $("#name, #surname, #email, #password").on("input", validateField);
    $("#password, #password-confirm").on("input", isPasswordsMatch);
    $("#email").on("keypress", debounce(isEmailUnique, 250));
    $("#register").on("click", register);
}

function validateField() {
    const field = $(this);
    const value = field.val();
    const id = field.attr("id");
    const regex = regexMap.get(id);
    const isValid = value.match(regex) != null;
    const errorMessage = field.parent().find(".error-message");

    if (isValid) {
        errorMessage.addClass("hidden");
        invalidStates.delete(id);
    } else {
        errorMessage.removeClass("hidden");
        invalidStates.add(id);
    }
}

async function isEmailUnique() {
    const field = $("#email");
    const email = field.val().trim();

    field.parent().find(".error-unique-message").addClass("hidden");

    if (email.length < 2 || email.match(EmailPattern) == null)
        return;

    const response = await fetch(`api/registration/email/${email}`);
    if (response.ok) {
        const { isUnique } = await response.json();

        if (isUnique === false)
            field.parent().find(".error-unique-message").removeClass("hidden");
    }
}

function isPasswordsMatch() {
    const password = $("#password").val();
    const confirm = $("#password-confirm").val();
    const errorMessage = $("#password-confirm").parent().find(".error-message");
    const isSame = password === confirm;

    if (isSame) {
        errorMessage.addClass("hidden");
        invalidStates.delete("password-confirm");
    } else {
        errorMessage.removeClass("hidden");
        invalidStates.add("password-confirm");
    }
}

function debounce(fn, delay = 1000) {
    let timer = null;

    return (...args) => {
        clearTimeout(timer);

        timer = setTimeout(() => fn(...args), delay);
    }
}

async function register(e) {
    e.preventDefault();

    if (invalidStates.size > 0)
        return;

    if ($(this).attr("data-processing") === true.toString())
        return;

    $(this).attr("data-processing", true);

    const buffer = new Map();
    const userFields = ["name", "surname", "email", "password"];
    userFields.forEach(field => buffer.set(field, $(`#${field}`).val().trim()));

    const model = Object.fromEntries(buffer.entries());

    const response = await fetch("api/registration", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(model),
    });
    if (response.ok) {
        $("form").addClass("hidden");
        $(".welcome").removeClass("hidden");
    } else if (response.status === 400) {
        $("#email").parent().find(".error-unique-message").removeClass("hidden");
    }

    $(this).attr("data-processing", false);
}

export default init;