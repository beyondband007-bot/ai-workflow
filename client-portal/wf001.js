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

function resolveAuthEntryUrl() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:8080/auth/?mode=login";
  }

  if (port === "3003") {
    return `${protocol}//${hostname}:8000/auth/?mode=login`;
  }

  return `${window.location.origin}/auth/?mode=login`;
}

const API_BASE = resolveApiBase();
const TOKEN_KEY = "auth_demo_token";
const PROFILE_STORAGE_KEY = "client_portal_profile";
const THEME_KEY = "client_portal_theme";
const ALLOWED_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

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
  if (window.ClientPortalAuth) {
    return window.ClientPortalAuth.readToken();
  }

  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    window.localStorage.setItem(TOKEN_KEY, urlToken);
    return urlToken;
  }

  const localToken = window.localStorage.getItem(TOKEN_KEY);
  if (localToken) {
    return localToken;
  }

  return null;
}

function clearAuthState() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.clearAuthState();
    return;
  }

  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_STORAGE_KEY);
}

function redirectToLogin() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.redirectToLogin();
    return;
  }

  clearAuthState();
  window.location.replace(resolveAuthEntryUrl());
}

function buildHeaders() {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new Error("请先登录后再打开 WF-001 页面。");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
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
    if (response.status === 401 && options.auth !== false) {
      redirectToLogin();
      throw new Error("登录已过期，请重新登录");
    }
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
    if (response.status === 401) {
      redirectToLogin();
      throw new Error("登录已过期，请重新登录");
    }
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

const statusTextMap = {
  success: "成功",
  running: "执行中",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

const billingStatusTextMap = {
  charged: "已扣费",
  frozen: "积分冻结中",
  rollback: "已退回",
};

function getRunImageUrls(run) {
  return Array.isArray(run?.result_urls) ? run.result_urls.filter(Boolean) : [];
}

function formatRunStatus(status) {
  return statusTextMap[status] || status || "未知";
}

function formatBillingStatus(status) {
  return billingStatusTextMap[status] || status || "-";
}

function buildResultSummary(run) {
  const status = run?.status;
  const imageCount = getRunImageUrls(run).length;

  if (status === "success") {
    return imageCount > 0 ? `生成成功，已返回 ${imageCount} 张图片。` : "生成成功。";
  }

  if (status === "failed") {
    return "生成失败，积分已按规则处理。";
  }

  if (status === "timeout") {
    return "生成超时，请稍后查看历史记录。";
  }

  if (status === "cancelled") {
    return "任务已取消。";
  }

  if (status === "running") {
    return "正在生成，请稍候。";
  }

  return "任务已更新。";
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

function renderRunning(prompt, aspectRatio) {
  setText("runIdValue", "-");
  setText("runStatusValue", "执行中");
  setText("billingStatusValue", "积分冻结中");
  setText("chargePointsValue", "0");
  setText("summaryText", `正在生成，图像比例：${aspectRatio}。`);
  renderGallery([]);
}

function renderResult(result) {
  const run = result?.run || {};
  setText("runIdValue", run.run_id || "-");
  setText("runStatusValue", formatRunStatus(run.status));
  setText("billingStatusValue", formatBillingStatus(run.billing_status));
  setText(
    "chargePointsValue",
    String(run.final_charge_points ?? run.estimated_frozen_points ?? 0),
  );
  setText("summaryText", buildResultSummary(run));
  renderGallery(getRunImageUrls(run));
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
  const historyLink = document.getElementById("historyLink");

  const token = window.localStorage.getItem(TOKEN_KEY);
  if (backLink) {
    backLink.href = token
      ? `./index.html?token=${encodeURIComponent(token)}`
      : "./index.html";
  }
  if (historyLink) {
    historyLink.href = token
      ? `./wf001_record.html?token=${encodeURIComponent(token)}`
      : "./wf001_record.html";
  }
}

function setAspectRatio(value) {
  if (!ALLOWED_ASPECT_RATIOS.includes(value)) {
    return;
  }

  const input = document.getElementById("aspectRatioSelect");
  const label = document.getElementById("aspectRatioLabel");
  const options = document.querySelectorAll(".wf-ratio-option");

  if (input) {
    input.value = value;
  }
  if (label) {
    label.textContent = value;
  }

  options.forEach((option) => {
    const isActive = option.dataset.ratio === value;
    option.classList.toggle("is-active", isActive);
    option.setAttribute("aria-selected", String(isActive));
  });
}

function closeAspectRatioPicker() {
  const picker = document.getElementById("aspectRatioPicker");
  const trigger = document.getElementById("aspectRatioTrigger");
  if (!picker || !trigger) {
    return;
  }

  picker.classList.remove("is-open");
  trigger.setAttribute("aria-expanded", "false");
}

function bindAspectRatioPicker() {
  const picker = document.getElementById("aspectRatioPicker");
  const trigger = document.getElementById("aspectRatioTrigger");
  const menu = document.getElementById("aspectRatioMenu");
  if (!picker || !trigger || !menu) {
    return;
  }

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = picker.classList.toggle("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
  });

  menu.addEventListener("click", (event) => {
    const option = event.target.closest(".wf-ratio-option");
    if (!option) {
      return;
    }

    setAspectRatio(option.dataset.ratio);
    closeAspectRatioPicker();
    trigger.focus();
  });

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) {
      closeAspectRatioPicker();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAspectRatioPicker();
    }
  });

  setAspectRatio(document.getElementById("aspectRatioSelect")?.value || "3:4");
}

function bindDemoPrompt() {
  const button = document.getElementById("fillDemoPrompt");
  const promptInput = document.getElementById("promptInput");
  const aspectRatioSelect = document.getElementById("aspectRatioSelect");
  if (!button || !promptInput) {
    return;
  }

  button.addEventListener("click", () => {
    promptInput.value =
      "生成一张电影感很强的中国美女写真，柔光，时尚杂志风格，细节清晰，人物自然，背景干净。";
    if (aspectRatioSelect) {
      setAspectRatio("3:4");
    }
  });
}

function bindForm() {
  const form = document.getElementById("wf001Form");
  const promptInput = document.getElementById("promptInput");
  const aspectRatioSelect = document.getElementById("aspectRatioSelect");
  const submitButton = document.getElementById("submitButton");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    const aspectRatio = aspectRatioSelect.value;
    if (!prompt) {
      window.alert("请先输入提示词。");
      promptInput.focus();
      return;
    }
    if (!ALLOWED_ASPECT_RATIOS.includes(aspectRatio)) {
      window.alert("请选择有效的图像比例。");
      document.getElementById("aspectRatioTrigger")?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "生成中...";
    renderRunning(prompt, aspectRatio);

    try {
      const result = await executeWorkflowRequest({ prompt, aspect_ratio: aspectRatio });
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
  const aspectRatioSelect = document.getElementById("aspectRatioSelect");
  const submitButton = document.getElementById("submitButton");

  if (!form || !promptInput || !aspectRatioSelect || !submitButton) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const prompt = promptInput.value.trim();
    const aspectRatio = aspectRatioSelect.value;
    if (!prompt) {
      window.alert("请先输入提示词。");
      promptInput.focus();
      return;
    }
    if (!ALLOWED_ASPECT_RATIOS.includes(aspectRatio)) {
      window.alert("请选择有效的图像比例。");
      document.getElementById("aspectRatioTrigger")?.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "生成中...";
    renderRunning(prompt, aspectRatio);

    try {
      const result = await executeWorkflowRequest({ prompt, aspect_ratio: aspectRatio });
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
      setText("summaryText", "生成失败，请稍后重试。");
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
    if (!getToken()) {
      redirectToLogin();
      return;
    }
    buildBackLink();
    bindAspectRatioPicker();
    bindDemoPrompt();
    bindFormSafe();
  } catch (error) {
    if (error.message !== "登录已过期，请重新登录") {
      window.alert(error.message);
    }
  }
}

bootstrap();
