const form = document.getElementById("carForm");
const carNameInput = document.getElementById("carName");
const mainInput = document.getElementById("mainImages");
const interiorInput = document.getElementById("interiorImages");
const pickMainBtn = document.getElementById("pickMainBtn");
const pickInteriorBtn = document.getElementById("pickInteriorBtn");
const submitBtn = document.getElementById("submitBtn");
const statusText = document.getElementById("statusText");
const mainPreview = document.getElementById("mainPreview");
const interiorPreview = document.getElementById("interiorPreview");
const lightbox = document.getElementById("lightbox");
const lightboxImage = document.getElementById("lightboxImage");
const closeLightboxBtn = document.getElementById("closeLightboxBtn");

const RUNTIME_CONFIG = window.__WF003_CONFIG__ || {};
const UPLOAD_PROXY_URL = RUNTIME_CONFIG.kieUploadUrl || "/api/kie-upload";
const KIE_API_KEY = RUNTIME_CONFIG.kieApiKey || "";
const RUNTIME_WEBHOOK_URL = (RUNTIME_CONFIG.workflowWebhookUrl || "").replace(/\/$/, "");
const RUNTIME_API_BASE = (RUNTIME_CONFIG.workflowApiBase || "").replace(/\/$/, "");
const DEFAULT_CALLBACK_URL = (RUNTIME_CONFIG.defaultCallbackUrl || "").trim();
const DEFAULT_CALLBACK_TOKEN = (RUNTIME_CONFIG.defaultCallbackToken || "").trim();
const DEFAULT_FEISHU_APP_ID = (RUNTIME_CONFIG.defaultFeishuAppId || "").trim();
const DEFAULT_FEISHU_ID = (RUNTIME_CONFIG.defaultFeishuId || "").trim();
const FIXED_LOGO_URL = "https://mycar.deepsix.store/logo/logo.png";
const TOKEN_KEY = "auth_demo_token";
const MAX_FILES_PER_GROUP = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_UPLOAD_CONCURRENCY = 3;
const WORKFLOW_CODE = "WF-003";

function resolveApiBase() {
  if (RUNTIME_WEBHOOK_URL) {
    return "";
  }

  if (RUNTIME_API_BASE) {
    return RUNTIME_API_BASE;
  }

  const query = new URLSearchParams(window.location.search);
  const override = query.get("apiBase") || window.localStorage.getItem("wf003_api_base");
  if (override) {
    window.localStorage.setItem("wf003_api_base", override);
    return override.replace(/\/$/, "");
  }

  const { protocol, hostname, port } = window.location;
  if (protocol === "file:") {
    return "http://127.0.0.1:3002";
  }

  if (port === "3001" || port === "3003") {
    return `${protocol}//${hostname}:3002`;
  }

  return "";
}

const API_BASE = resolveApiBase();

const state = {
  main: [],
  interior: [],
  isSubmitting: false,
};

function setStatus(text, className) {
  statusText.textContent = text;
  statusText.className = `status ${className || ""}`.trim();
}

function createItem(file) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    file,
    url: URL.createObjectURL(file),
    uploading: false,
  };
}

function destroyItems(items) {
  items.forEach((item) => URL.revokeObjectURL(item.url));
}

function resetInput(input) {
  input.value = "";
}

function removeItem(group, id) {
  if (state.isSubmitting) {
    return;
  }

  const next = [];
  state[group].forEach((item) => {
    if (item.id === id) {
      URL.revokeObjectURL(item.url);
      return;
    }
    next.push(item);
  });

  state[group] = next;
  renderGroup(group);
}

function openLightbox(url) {
  lightboxImage.src = url;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  lightbox.classList.add("hidden");
  lightboxImage.src = "";
}

function createThumb(group, item) {
  const card = document.createElement("div");
  card.className = `thumb${item.uploading ? " is-uploading" : ""}`;

  const previewBtn = document.createElement("button");
  previewBtn.type = "button";
  previewBtn.className = "thumb-button";
  previewBtn.setAttribute("aria-label", `预览 ${item.file.name}`);
  previewBtn.addEventListener("click", () => openLightbox(item.url));

  const image = document.createElement("img");
  image.src = item.url;
  image.alt = item.file.name;
  previewBtn.appendChild(image);

  const name = document.createElement("div");
  name.className = "thumb-name";
  name.textContent = item.file.name;
  previewBtn.appendChild(name);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "thumb-remove";
  removeBtn.setAttribute("aria-label", `删除 ${item.file.name}`);
  removeBtn.textContent = "x";
  removeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    removeItem(group, item.id);
  });

  const overlay = document.createElement("div");
  overlay.className = "thumb-overlay";
  overlay.innerHTML = '<span class="spinner" aria-hidden="true"></span>';

  card.appendChild(previewBtn);
  card.appendChild(removeBtn);
  card.appendChild(overlay);
  return card;
}

function renderGroup(group) {
  const container = group === "main" ? mainPreview : interiorPreview;
  container.innerHTML = "";

  if (!state[group].length) {
    const empty = document.createElement("div");
    empty.className = "empty-preview";
    empty.textContent = "尚未选择图片";
    container.appendChild(empty);
    return;
  }

  state[group].forEach((item) => {
    container.appendChild(createThumb(group, item));
  });
}

function markUploading(uploading) {
  state.isSubmitting = uploading;
  ["main", "interior"].forEach((group) => {
    state[group] = state[group].map((item) => ({ ...item, uploading }));
    renderGroup(group);
  });

  submitBtn.disabled = uploading;
  pickMainBtn.disabled = uploading;
  pickInteriorBtn.disabled = uploading;
}

function clearAll() {
  destroyItems(state.main);
  destroyItems(state.interior);
  state.main = [];
  state.interior = [];
  form.reset();
  resetInput(mainInput);
  resetInput(interiorInput);
  renderGroup("main");
  renderGroup("interior");
}

function getToken() {
  const query = new URLSearchParams(window.location.search);
  const queryKeys = ["token", "access_token", "auth_token", "jwt"];
  for (const key of queryKeys) {
    const value = query.get(key);
    if (value && value.trim()) {
      const cleaned = value.replace(/^Bearer\s+/i, "").trim();
      if (cleaned) {
        window.localStorage.setItem(TOKEN_KEY, cleaned);
        return cleaned;
      }
    }
  }

  const localKeys = [TOKEN_KEY, "access_token", "auth_token", "jwt"];
  for (const key of localKeys) {
    const value = window.localStorage.getItem(key);
    if (value && value.trim()) {
      const cleaned = value.replace(/^Bearer\s+/i, "").trim();
      if (cleaned) {
        return cleaned;
      }
    }
  }

  return null;
}

function appendFiles(group, files) {
  const selected = Array.from(files || []);
  const oversize = selected.find((file) => file.size > MAX_FILE_SIZE);

  if (oversize) {
    setStatus(`图片 ${oversize.name} 超过10MB，请重新选择`, "error");
    return;
  }

  if (state[group].length + selected.length > MAX_FILES_PER_GROUP) {
    const groupLabel = group === "main" ? "main images" : "interior images";
    setStatus(`您最多可以选择 ${MAX_FILES_PER_GROUP} 张 ${groupLabel}`, "error");
    return;
  }

  const incoming = selected.map(createItem);
  state[group] = state[group].concat(incoming);
  renderGroup(group);
  setStatus("图片已加入预览，尚未提交", "");
}

function buildApiUrl(path) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

function buildAuthHeaderOnly() {
  const token = getToken();
  if (!token) {
    throw new Error("缺少身份验证令牌，请从客户端门户打开此页面。");
  }
  return {
    Authorization: `Bearer ${token}`,
  };
}

function buildHeaders() {
  const token = getToken();
  if (!token) {
    throw new Error("缺少身份验证令牌，请从客户端门户打开此页面。");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function fetchCurrentUserMetadata() {
  const response = await fetch(buildApiUrl("/api/v1/point-accounts/me"), {
    method: "GET",
    headers: buildAuthHeaderOnly(),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("登录态已失效（401），请重新登录并刷新页面。");
    }
    throw new Error(data?.message || data?.error || `读取用户配置失败 (${response.status})`);
  }

  const userId = String(data?.user_id || "").trim();
  const feishuAppId = String(data?.feishu_app_id || "").trim();
  const feishuId = String(data?.feishu_id || "").trim();

  return {
    user_id: userId,
    feishu_app_id: feishuAppId,
    feishu_id: feishuId,
  };
}

function validateBeforeSubmit(carName) {
  if (!carName) {
    setStatus("请输入车辆名称", "error");
    return false;
  }

  if (!state.main.length) {
    setStatus("请上传至少1张主图", "error");
    return false;
  }

  if (!state.interior.length) {
    setStatus("请上传至少1张内饰图", "error");
    return false;
  }

  const allImages = [...state.main, ...state.interior];
  const oversize = allImages.find((item) => item.file.size > MAX_FILE_SIZE);
  if (oversize) {
    setStatus(`图片 ${oversize.file.name} 超过10MB，请重新选择`, "error");
    return false;
  }

  return true;
}

async function uploadAsset(file, uploadPath) {
  const formData = new FormData();
  formData.append("file", file, file.name);
  formData.append("uploadPath", uploadPath);
  formData.append("fileName", file.name);

  const headers = {};
  if (KIE_API_KEY) {
    headers.Authorization = `Bearer ${KIE_API_KEY}`;
  }

  const response = await fetch(UPLOAD_PROXY_URL, {
    method: "POST",
    headers,
    body: formData,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (text && /cloudflare|sorry,\s*you\s*have\s*been\s*blocked/i.test(text)) {
      throw new Error(`Kie upload blocked by Cloudflare (${response.status})`);
    }
    throw new Error(data?.msg || data?.message || `Kie upload failed (${response.status})`);
  }

  if (!data?.success || !data?.data?.downloadUrl) {
    throw new Error(data?.msg || data?.message || "Kie上传返回无下载链接");
  }

  return data.data.downloadUrl;
}

async function uploadBatchAssets(items, typeLabel, uploadPath, concurrency = DEFAULT_UPLOAD_CONCURRENCY) {
  const total = items.length;
  const urls = new Array(total);
  let cursor = 0;

  async function worker() {
    while (cursor < total) {
      const currentIndex = cursor;
      cursor += 1;

      const currentItem = items[currentIndex];
      setStatus(`正在上传 ${typeLabel} ${currentIndex + 1}/${total}...`, "");

      try {
        urls[currentIndex] = await uploadAsset(currentItem.file, uploadPath);
      } catch (error) {
        throw new Error(`${typeLabel} "${currentItem.file.name}" upload failed: ${error.message}`);
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, total));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return urls;
}

function buildWorkflowPayload(carName, mainUrls, interiorUrls, logoUrl, userMeta) {
  const query = new URLSearchParams(window.location.search);
  const runId = `wf003_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const workflowCode = WORKFLOW_CODE;
  const clientRequestId = query.get("client_request_id") || runId;
  const userId = (userMeta?.user_id || query.get("user_id") || "").trim();
  const feishuAppId = (userMeta?.feishu_app_id || query.get("feishu_app_id") || DEFAULT_FEISHU_APP_ID).trim();
  const feishuId = (userMeta?.feishu_id || query.get("feishu_id") || DEFAULT_FEISHU_ID).trim();
  const callbackUrl = query.get("callback_url") || DEFAULT_CALLBACK_URL;
  const callbackToken = query.get("callback_token") || DEFAULT_CALLBACK_TOKEN;

  return {
    run_id: runId,
    workflow_code: workflowCode,
    client_request_id: clientRequestId,
    user_id: userId,
    feishu_app_id: feishuAppId,
    feishu_id: feishuId,
    callback_url: callbackUrl,
    callback_token: callbackToken,
    car_name: carName,
    exterior_images: mainUrls,
    interior_images: interiorUrls,
    logo: logoUrl,
    source: "wf003_frontend_direct_to_kie",
    submitted_at: new Date().toISOString(),
  };
}

async function submitWorkflow(payload) {
  const requestUrl = RUNTIME_WEBHOOK_URL || buildApiUrl(`/api/v1/workflows/${WORKFLOW_CODE}/json-execute`);
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `工作流提交失败 (${response.status}): ${requestUrl}`);
  }

  return data;
}

pickMainBtn.addEventListener("click", () => mainInput.click());
pickInteriorBtn.addEventListener("click", () => interiorInput.click());

mainInput.addEventListener("change", () => {
  const files = mainInput.files;
  if (files.length > MAX_FILES_PER_GROUP) {
    setStatus(`您最多可以选择 ${MAX_FILES_PER_GROUP} 张主图`, "error");
    resetInput(mainInput);
    return;
  }

  appendFiles("main", files);
  resetInput(mainInput);
});

interiorInput.addEventListener("change", () => {
  const files = interiorInput.files;
  if (files.length > MAX_FILES_PER_GROUP) {
    setStatus(`您一次最多可以选择 ${MAX_FILES_PER_GROUP} 张内饰图`, "error");
    resetInput(interiorInput);
    return;
  }

  appendFiles("interior", files);
  resetInput(interiorInput);
});

closeLightboxBtn.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) {
    closeLightbox();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !lightbox.classList.contains("hidden")) {
    closeLightbox();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const carName = carNameInput.value.trim();
  if (!validateBeforeSubmit(carName)) {
    return;
  }

  try {
    markUploading(true);
    setStatus("正在上传图片到 Kie...", "");

    setStatus("正在读取用户飞书配置...", "");
    const userMeta = await fetchCurrentUserMetadata();
    if (!userMeta.feishu_app_id || !userMeta.feishu_id) {
      throw new Error("当前账号未绑定飞书配置（feishu_app_id / feishu_id），请先在系统中完成绑定。");
    }

    const [mainUrls, interiorUrls] = await Promise.all([
      uploadBatchAssets(state.main, "main image", "car-exterior"),
      uploadBatchAssets(state.interior, "interior image", "car-interior"),
    ]);

    setStatus("冻结点和提交工作流程……", "");

    const payload = buildWorkflowPayload(carName, mainUrls, interiorUrls, FIXED_LOGO_URL, userMeta);
    const result = await submitWorkflow(payload);

    // console.log("工作流有效负载：", payload);
    // console.log("工作流程结果：", result);

    const frozenPoints = result?.estimated_frozen_points ?? result?.run?.estimated_frozen_points ?? 0;
    const runId = result?.run?.run_id || result?.client_request_id || "-";
    setStatus(`已成功提交，冻结了 ${frozenPoints} 点积分`, "ok");
    alert(`提交成功`);
    clearAll();
    setStatus("等待提交", "");
  } catch (error) {
    // console.error("提交失败：", error);
    setStatus(error.message || "提交失败，请重试。", "error");
    alert(`提交失败：${error.message}`);
  } finally {
    markUploading(false);
  }
});

renderGroup("main");
renderGroup("interior");
