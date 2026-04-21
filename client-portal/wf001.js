function resolveApiBase() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:3002";
  }

  if (port === "3003") {
    return `${protocol}//${hostname}:3002`;
  }

  return "";
}

const API_BASE = resolveApiBase();
const TOKEN_KEY = "auth_demo_token";
const THEME_KEY = "client_portal_theme";

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;
}

function initTheme() {
  try {
    applyTheme(window.localStorage.getItem(THEME_KEY) || "light");
  } catch {
    applyTheme("light");
  }

  window.addEventListener("storage", (event) => {
    if (event.key === THEME_KEY) {
      applyTheme(event.newValue || "light");
    }
  });
}

function getToken() {
  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    window.localStorage.setItem(TOKEN_KEY, urlToken);
    return urlToken;
  }

  const localToken = window.localStorage.getItem(TOKEN_KEY);
  if (localToken) {
    return localToken;
  }

  const manualToken = window.prompt("请粘贴登录后拿到的 auth_demo_token");
  if (manualToken && manualToken.trim()) {
    window.localStorage.setItem(TOKEN_KEY, manualToken.trim());
    return manualToken.trim();
  }

  throw new Error("未找到有效 token，请先登录后再打开 WF-001 页面。");
}

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${getToken()}`,
  };
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(options.auth === false ? {} : buildHeaders()),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      const preview = text.slice(0, 160).replace(/\s+/g, " ").trim();
      throw new Error(
        preview ? `接口返回了非 JSON 内容：${preview}` : "接口返回了空响应",
      );
    }
  }

  if (!response.ok) {
    throw new Error(data?.message || data?.detail || `请求失败: ${response.status}`);
  }

  return data;
}

async function executeWorkflow(payload) {
  const response = await fetch(`${API_BASE}/api/v1/workflows/WF-001/execute`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.detail || `请求失败: ${response.status}`);
  }

  return data;
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

async function executeWorkflowRequest(payload) {
  return requestJson("/api/v1/workflows/WF-001/execute", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function loadLatestWf001Run() {
  const runs = await requestJson("/api/v1/workflow-runs");
  const workflowRuns = Array.isArray(runs) ? runs : [];
  return workflowRuns.find((run) => run?.workflow_code === "WF-001") || null;
}

function renderGallery(urls) {
  const gallery = document.getElementById("resultGallery");
  const emptyState = document.getElementById("resultEmpty");
  const imageUrls = Array.isArray(urls) ? urls.filter(Boolean) : [];

  if (!imageUrls.length) {
    gallery.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }

  emptyState.style.display = "none";
  gallery.innerHTML = imageUrls
    .map(
      (url, index) => `
        <article class="wf-gallery-item">
          <img src="${url}" alt="WF-001 result ${index + 1}" />
          <a href="${url}" target="_blank" rel="noreferrer">查看原图 ${index + 1}</a>
        </article>
      `,
    )
    .join("");
}

function renderRunning(prompt) {
  setText("runIdValue", "-");
  setText("runStatusValue", "执行中");
  setText("billingStatusValue", "处理中");
  setText("chargePointsValue", "0");
  setText("summaryText", `正在处理提示词：${prompt}`);
  renderGallery([]);
}

function renderResult(result) {
  const run = result?.run || {};
  setText("runIdValue", run.run_id || "-");
  setText("runStatusValue", run.status || "unknown");
  setText("billingStatusValue", run.billing_status || "-");
  setText(
    "chargePointsValue",
    String(run.final_charge_points ?? run.estimated_frozen_points ?? 0),
  );
  setText(
    "summaryText",
    run.result_summary || "工作流已执行完成，但暂未返回结果摘要。",
  );
  renderGallery(run.result_urls || []);
}

async function recoverLatestWf001Result() {
  const latestRun = await loadLatestWf001Run();
  if (!latestRun) {
    return false;
  }

  renderResult({ run: latestRun });
  return true;
}

function buildBackLink() {
  const backLink = document.getElementById("backLink");
  if (!backLink) {
    return;
  }

  const token = window.localStorage.getItem(TOKEN_KEY);
  backLink.href = token
    ? `./index.html?token=${encodeURIComponent(token)}`
    : "./index.html";
}

function bindDemoPrompt() {
  const button = document.getElementById("fillDemoPrompt");
  const promptInput = document.getElementById("promptInput");
  if (!button || !promptInput) {
    return;
  }

  button.addEventListener("click", () => {
    promptInput.value =
      "生成一张电影感很强的中国美女写真，柔光，时尚杂志风格，细节清晰，人物自然，背景干净。";
  });
}

function bindForm() {
  const form = document.getElementById("wf001Form");
  const promptInput = document.getElementById("promptInput");
  const submitButton = document.getElementById("submitButton");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    if (!prompt) {
      window.alert("请先输入提示词。");
      promptInput.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "生成中...";
    renderRunning(prompt);

    try {
      const result = await executeWorkflowRequest({ prompt });
      renderResult(result);
    } catch (error) {
      setText("runStatusValue", "失败");
      setText("billingStatusValue", "回滚中");
      setText("summaryText", error.message);
      renderGallery([]);
      window.alert(`WF-001 执行失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "开始生成";
    }
  });
}

function bindFormSafe() {
  const form = document.getElementById("wf001Form");
  const promptInput = document.getElementById("promptInput");
  const submitButton = document.getElementById("submitButton");

  if (!form || !promptInput || !submitButton) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    if (!prompt) {
      window.alert("请先输入提示词。");
      promptInput.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "生成中...";
    renderRunning(prompt);

    try {
      const result = await executeWorkflowRequest({ prompt });
      renderResult(result);
    } catch (error) {
      try {
        const recovered = await recoverLatestWf001Result();
        if (recovered) {
          setText(
            "summaryText",
            `执行接口返回异常，但已从中台恢复最近一次 WF-001 结果。原始错误：${error.message}`,
          );
          window.alert(`WF-001 接口返回异常，但结果已从中台恢复显示。\n${error.message}`);
          return;
        }
      } catch (recoveryError) {
        console.error("recover latest wf001 result failed", recoveryError);
      }

      setText("runStatusValue", "失败");
      setText("billingStatusValue", "异常");
      setText("summaryText", error.message);
      renderGallery([]);
      window.alert(`WF-001 执行失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "开始生成";
    }
  });
}

function bootstrap() {
  try {
    initTheme();
    getToken();
    buildBackLink();
    bindDemoPrompt();
    bindFormSafe();
  } catch (error) {
    window.alert(error.message);
  }
}

bootstrap();
