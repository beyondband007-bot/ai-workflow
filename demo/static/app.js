const tokenKey = "auth_demo_token";

const registerForm = document.querySelector("#register-form");
const loginForm = document.querySelector("#login-form");
const loadMeButton = document.querySelector("#load-me");
const logoutButton = document.querySelector("#logout");
const tokenOutput = document.querySelector("#token-output");
const meOutput = document.querySelector("#me-output");
const messageOutput = document.querySelector("#message-output");
const sessionStatus = document.querySelector("#session-status");

function setMessage(value) {
    messageOutput.textContent = value;
}

function saveToken(token) {
    localStorage.setItem(tokenKey, token);
    renderSession();
}

function getToken() {
    return localStorage.getItem(tokenKey);
}

function clearToken() {
    localStorage.removeItem(tokenKey);
    renderSession();
}

function renderSession() {
    const token = getToken();

    if (token) {
        sessionStatus.textContent = "已登录";
        tokenOutput.textContent = token;
        return;
    }

    sessionStatus.textContent = "未登录";
    tokenOutput.textContent = "暂无 token";
    meOutput.textContent = "暂无用户数据";
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
        ...options,
    });

    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(data.detail || "请求失败");
    }

    return data;
}

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    const payload = Object.fromEntries(formData.entries());

    try {
        const result = await requestJson("/register", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        setMessage(`注册成功:\n${JSON.stringify(result, null, 2)}`);
        registerForm.reset();
    } catch (error) {
        setMessage(`注册失败: ${error.message}`);
    }
});

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const payload = Object.fromEntries(formData.entries());

    try {
        const result = await requestJson("/login", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        saveToken(result.access_token);
        setMessage("登录成功，token 已保存到浏览器本地存储。");
        meOutput.textContent = "点击“获取当前用户”查看接口返回。";
        loginForm.reset();
    } catch (error) {
        setMessage(`登录失败: ${error.message}`);
    }
});

loadMeButton.addEventListener("click", async () => {
    const token = getToken();

    if (!token) {
        setMessage("请先登录，再获取当前用户信息。");
        return;
    }

    try {
        const result = await requestJson("/me", {
            method: "GET",
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
        meOutput.textContent = JSON.stringify(result, null, 2);
        setMessage("当前用户信息获取成功。");
    } catch (error) {
        setMessage(`获取用户信息失败: ${error.message}`);
    }
});

logoutButton.addEventListener("click", () => {
    clearToken();
    setMessage("已退出登录并清除本地 token。");
});

renderSession();
