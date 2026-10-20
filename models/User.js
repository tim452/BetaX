import mongoose from "../libs/mongoose.js";
import crypto from "crypto";
import config from "config";

const EmailPattern = /^[a-z0-9._-]+@[a-z0-9._-]+\.[a-z0-9._-]+$/ig;
const PasswordPattern = /^(?=.*([a-zа-я]))(?=.*(\d))(?=.*([^a-zа-я0-9]))(?!.*(\s)).{8,}/ig;
const NamePattern = /^(?!.*(\d))(?!.*[№._`~!@#$%^&*()\-+={\[\]}\\|:;"'<,>?/]).{2,}/ig;
const SurnamePattern = /^(?=[a-zа-я])(?!.*-+.*-+)(?!.*(\d))(?!.*[№._`~!@#$%^&*()+={\[\]}\\|:;"'<,>?/]).{2,}/ig;

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: "Укажите email",
        unique: "Такой email уже есть",
        validate: [{
            validator(email) {
                return email.match(EmailPattern);
            },
            message: "Укажите, пожалуйста, корректный email"
        }],
        lowercase: true,
        trim: true
    },
    name: {
        type: String,
        required: "Укажите имя",
        validate: [{
            validator(name) {
                return name.match(NamePattern);
            },
            message: "Укажите, пожалуйста, корректное имя"
        }],
        trim: true
    },
    surname: {
        type: String,
        required: "Укажите фамилию",
        validate: [{
            validator(surname) {
                return surname.match(SurnamePattern);
            },
            message: "Укажите, пожалуйста, корректную фамилию"
        }],
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    salt: {
        type: String,
        required: true
    },
    online: {
        type: String
    }
}, {
    timestamps: true,
});

userSchema.virtual("password")
    .set(function (password) {
        if (password == null || !password.match(PasswordPattern)) {
            this.invalidate("password",
                "Пароль должен быть минимум 8 символов и содержать буквы, цифры и спецсимволы");
        }

        this.salt = crypto
            .randomBytes(config.get("crypto.hash.length"))
            .toString("base64");
        this.passwordHash = crypto.pbkdf2Sync(
            password,
            this.salt,
            config.get("crypto.hash.iterations"),
            config.get("crypto.hash.length"),
            "sha512"
        ).toString("base64");
    });

userSchema.methods.checkPassword = function (password) {
    if (!password) {
        return false;
    }

    const hash = crypto.pbkdf2Sync(
        password,
        this.salt,
        config.get("crypto.hash.iterations"),
        config.get("crypto.hash.length"),
        "sha512"
    ).toString("base64");
    return hash === this.passwordHash;
};

userSchema.methods.toModel = function () {
    const { name, surname, id, online } = this;

    return {
        id,
        name,
        surname,
        online
    };
};

const User = mongoose.model("User", userSchema);

export { User };
