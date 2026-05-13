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
const ALLOWED_ASPECT_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16"];

function getToken() {
  if (window.ClientPortalAuth) {
    return window.ClientPortalAuth.readToken();
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
    throw new Error("请先登录后再打开 WF-002 页面。");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function executeWorkflow(payload) {
  const requestOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  };
  const response = window.ClientPortalAuth
    ? await window.ClientPortalAuth.authFetch("/api/v1/workflows/WF-002/webhook-execute", requestOptions)
    : await fetch(`${API_BASE}/api/v1/workflows/WF-002/webhook-execute`, {
        ...requestOptions,
        headers: buildHeaders(),
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
          <img src="${url}" alt="WF-002 result ${index + 1}" />
          <a href="${url}" target="_blank" rel="noreferrer">查看原图 ${index + 1}</a>
        </article>
      `,
    )
    .join("");
}

function renderRawResponse(rawResponse) {
  const rawBox = document.getElementById("rawResponse");
  rawBox.textContent = JSON.stringify(rawResponse ?? null, null, 2);
}

function renderRunning(prompt, aspectRatio) {
  setText("runIdValue", "-");
  setText("runStatusValue", "执行中");
  setText("billingStatusValue", "处理中");
  setText("chargePointsValue", "0");
  setText(
    "summaryText",
    `正在提交到 n8n webhook：${prompt}，比例 ${aspectRatio}。这条链路通常会在几十秒内返回，少数特殊情况会更久，请保持页面打开。`,
  );
  setText("upstreamStatusValue", "-");
  renderGallery([]);
  renderRawResponse(null);
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
  setText("summaryText", result.message || run.result_summary || "WF-002 已执行完成。");
  setText("upstreamStatusValue", String(result.upstream_status ?? "-"));
  renderGallery(result.image_urls || run.result_urls || []);
  renderRawResponse(result.raw_response);
}

function buildBackLink() {
  const backLink = document.getElementById("backLink");
  if (!backLink) {
    return;
  }
  backLink.href = "./index.html";
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
      "生成一张电影感很强的中国美女写真，柔光，细节清晰，时尚杂志风格。";
    if (aspectRatioSelect) {
      aspectRatioSelect.value = "3:4";
    }
  });
}

function bindForm() {
  const form = document.getElementById("wf002Form");
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
      aspectRatioSelect.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "提交中...";
    renderRunning(prompt, aspectRatio);

    try {
      const result = await executeWorkflow({ prompt, aspect_ratio: aspectRatio });
      renderResult(result);
    } catch (error) {
      setText("runStatusValue", "失败");
      setText("billingStatusValue", "回滚中");
      setText("summaryText", error.message);
      renderGallery([]);
      renderRawResponse({ error: error.message });
      window.alert(`WF-002 执行失败：${error.message}`);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "提交到 webhook";
    }
  });
}

async function bootstrap() {
  try {
    await window.ClientPortalAuth?.ensureAuthenticated();
    buildBackLink();
    bindDemoPrompt();
    bindForm();
  } catch (error) {
    if (error.message !== "登录已过期，请重新登录") {
      window.alert(error.message);
    }
  }
}

bootstrap();
