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
const TOKEN_KEY = "auth_demo_token";

const state = {
  main: [],
  interior: [],
  isSubmitting: false,
};

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

  return null;
}

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

// function appendFiles(group, files) {
//   const incoming = Array.from(files || []).map(createItem);
//   state[group] = state[group].concat(incoming);
//   renderGroup(group);
//   setStatus("图片已加入预览，尚未提交", "");
// }

function appendFiles(group, files) {
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  const selected = Array.from(files || []);

  const oversize = selected.find((file) => file.size > MAX_FILE_SIZE);
  if (oversize) {
    setStatus(`图片 ${oversize.name} 超过10MB，无法上传`, "error");
    return;
  }

  const incoming = selected.map(createItem);
  state[group] = state[group].concat(incoming);
  renderGroup(group);
  setStatus("图片已加入预览，尚未提交", "");
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
  removeBtn.textContent = "×";
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

async function fetchLogoBlob() {
  const response = await fetch("./logo/logo.png", { cache: "no-store" });
  if (!response.ok) {
    throw new Error("无法读取企业 LOGO");
  }
  return response.blob();
}

async function submitWorkflow(formData) {
  const token = getToken();
  if (!token) {
    throw new Error("未找到登录凭证，请从积分门户重新进入 WF-003 页面");
  }

  const response = await fetch("/api/car-export-submit", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`提交失败 (${response.status}) ${message}`);
  }

  return response.json();
}

pickMainBtn.addEventListener("click", () => mainInput.click());
pickInteriorBtn.addEventListener("click", () => interiorInput.click());

// mainInput.addEventListener("change", () => {
//   appendFiles("main", mainInput.files);
//   resetInput(mainInput);
// });

// interiorInput.addEventListener("change", () => {
//   appendFiles("interior", interiorInput.files);
//   resetInput(interiorInput);
// });

mainInput.addEventListener("change", () => {
  const files = mainInput.files;
  if (files.length > 5) {
    setStatus("单次最多选择5张图片", "error");
    resetInput(mainInput);
    return;
  }
  if (state.main.length + files.length > 5) {
    setStatus(`主图最多5张，当前已有 ${state.main.length} 张`, "error");
    resetInput(mainInput);
    return;
  }
  appendFiles("main", files);
  resetInput(mainInput);
});

interiorInput.addEventListener("change", () => {
  const files = interiorInput.files;
  if (files.length > 5) {
    setStatus("单次最多选择5张图片", "error");
    resetInput(interiorInput);
    return;
  }
  if (state.interior.length + files.length > 5) {
    setStatus(`内饰图最多5张，当前已有 ${state.interior.length} 张`, "error");
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
  if (!carName) {
    setStatus("请填写车名", "error");
    return;
  }
  if (!state.main.length) {
    setStatus("请至少上传 1 张汽车主图", "error");
    return;
  }
  if (!state.interior.length) {
    setStatus("请至少上传 1 张汽车内饰图", "error");
    return;
  }

  try {
    markUploading(true);
    setStatus("正在提交运行...", "");

    const formData = new FormData();
    formData.append("car_name", carName);
    state.main.forEach((item) => {
      formData.append("exterior_images", item.file, item.file.name);
    });
    state.interior.forEach((item) => {
      formData.append("interior_images", item.file, item.file.name);
    });

    const logoBlob = await fetchLogoBlob();
    formData.append("logo", logoBlob, "logo.png");

    const result = await submitWorkflow(formData);
    window.lastUploadResult = result;
    console.log("Upload result:", result);
    setStatus("已经提交运行", "ok");
    window.alert("已经提交运行");
    clearAll();
    setStatus("等待提交", "");
  } catch (error) {
    setStatus(error.message || "提交失败，请稍后重试", "error");
  } finally {
    markUploading(false);
  }
});

renderGroup("main");
renderGroup("interior");
