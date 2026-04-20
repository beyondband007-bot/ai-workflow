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

function resolveWf003PortalUrl() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:3001/";
  }

  const normalizedHost = String(hostname || "").toLowerCase();
  if (
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "0.0.0.0" ||
    port === "8080" ||
    port === "3003"
  ) {
    return `${protocol}//${hostname || "127.0.0.1"}:3001/`;
  }

  return "https://mycar.deepsix.store/";
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
const DEFAULT_AVATAR_SRC = "./logo.png";
let latestWorkflowRuns = [];
let latestRecordFilter = "all";
let refreshTimer = null;
let profileState = null;
let pendingAvatarDataUrl = "";
let pendingAvatarFile = null;

const fallbackPointAccount = {
  user_id: "-",
  available_points: 0,
  frozen_points: 0,
  total_recharged_points: 0,
  total_consumed_points: 0,
  today_runs: 0,
  today_spent_points: 0,
};

const apiContracts = [
  {
    endpoint: "GET /api/v1/workflows",
    purpose: "读取工作流入口配置",
    fields: ["workflow_code", "workflow_name", "metering_mode", "base_points"],
  },
  {
    endpoint: "GET /api/v1/point-accounts/me",
    purpose: "读取当前账号积分余额",
    fields: ["available_points", "frozen_points", "today_runs", "today_spent_points"],
  },
  {
    endpoint: "GET /api/v1/workflow-runs",
    purpose: "读取当前账号调用记录",
    fields: ["run_id", "workflow_code", "status", "billing_status", "result_summary"],
  },
  {
    endpoint: "POST /api/v1/workflow-runs/register",
    purpose: "工作流预冻结积分",
    fields: ["workflow_code", "client_request_id", "request_payload_summary"],
  },
  {
    endpoint: "POST /api/v1/workflows/WF-001/execute",
    purpose: "WF-001 前端页面发起执行",
    fields: ["prompt"],
  },
];

const statusTextMap = {
  success: "成功",
  running: "执行中",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

const billingStatusTextMap = {
  charged: "已扣费",
  frozen: "已冻结",
  rollback: "已回滚",
};

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("zh-CN");
}

function formatPoints(value) {
  return `${formatNumber(value)}`;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
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

  return null;
}

function getAuthHeaders() {
  const token = getToken();
  if (!token) {
    throw new Error("未找到有效 token，请先登录并重新打开门户页");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function readStoredProfile() {
  try {
    const raw = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("failed to read profile settings", error);
    return null;
  }
}

function writeStoredProfile(profile) {
  try {
    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch (error) {
    console.warn("failed to write profile settings", error);
  }
}

function normalizeDisplayName(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .slice(0, 24);
}

function normalizePhone(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
}

function normalizeAddress(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 255);
}

function ensureProfileFormFields() {
  const form = document.getElementById("profileForm");
  if (!form) {
    return;
  }

  const displayNameInput = document.getElementById("profileDisplayNameInput");
  const phoneInput = document.getElementById("profilePhoneInput");
  const formHint = form.querySelector(".profile-form-hint");
  if (displayNameInput) {
    displayNameInput.maxLength = 24;
  }
  if (phoneInput) {
    phoneInput.maxLength = 20;
    phoneInput.required = false;
  }

  let addressInput = document.getElementById("profileAddressInput");
  if (!addressInput) {
    const addressField = document.createElement("label");
    addressField.className = "profile-field";
    addressField.innerHTML =
      '<span>地址</span><input id="profileAddressInput" name="address" type="text" maxlength="255" placeholder="请输入地址" />';
    if (formHint) {
      form.insertBefore(addressField, formHint);
    } else {
      form.appendChild(addressField);
    }
    addressInput = addressField.querySelector("input");
  }
}

function getProfileElements() {
  ensureProfileFormFields();
  return {
    menuRoot: document.getElementById("profileMenu"),
    menuTrigger: document.getElementById("profileMenuTrigger"),
    menuDropdown: document.getElementById("profileMenuDropdown"),
    topbarDisplayName: document.querySelector("#profileMenuTrigger .topbar-profile-copy span"),
    topbarAvatar: document.getElementById("profileAvatarImage"),
    menuAvatar: document.getElementById("profileMenuAvatarImage"),
    menuDisplayName: document.getElementById("profileMenuDisplayName"),
    menuUsername: document.getElementById("profileMenuUsername"),
    editButton: document.getElementById("profileEditButton"),
    logoutButton: document.getElementById("profileLogoutButton"),
    modal: document.getElementById("profileModal"),
    modalClose: document.getElementById("profileModalClose"),
    modalCancel: document.getElementById("profileModalCancel"),
    modalBackdrop: document.querySelector("[data-profile-close='true']"),
    form: document.getElementById("profileForm"),
    avatarPreview: document.getElementById("profileAvatarPreview"),
    avatarInput: document.getElementById("profileAvatarInput"),
    avatarUpload: document.getElementById("profileAvatarUpload"),
    displayNameInput: document.getElementById("profileDisplayNameInput"),
    usernameInput: document.getElementById("profileUsernameInput"),
    phoneInput: document.getElementById("profilePhoneInput"),
    addressInput: document.getElementById("profileAddressInput"),
    submitButton: document.querySelector("#profileForm button[type='submit']"),
    formError: document.getElementById("profileFormError"),
  };
}

function getProfileDefaults() {
  const elements = getProfileElements();
  return {
    displayName: normalizeDisplayName(elements.topbarDisplayName?.textContent || "Workflow Points"),
    username: normalizeUsername(elements.menuUsername?.textContent?.replace(/^@/, "") || "workflow_points"),
    avatarDataUrl: "",
    phone: "",
    address: "",
  };
}

function resolveProfileState(overrides = {}) {
  const defaults = getProfileDefaults();
  return {
    displayName: normalizeDisplayName(overrides.displayName || profileState?.displayName || defaults.displayName) || defaults.displayName,
    username: normalizeUsername(overrides.username || profileState?.username || defaults.username) || defaults.username,
    avatarDataUrl: String(overrides.avatarDataUrl ?? profileState?.avatarDataUrl ?? defaults.avatarDataUrl ?? ""),
    phone: normalizePhone(overrides.phone ?? profileState?.phone ?? defaults.phone),
    address: normalizeAddress(overrides.address ?? profileState?.address ?? defaults.address),
  };
}

function renderProfile(profile, options = {}) {
  const elements = getProfileElements();
  if (!elements.menuTrigger) {
    return;
  }

  profileState = resolveProfileState(profile);
  const avatarSrc = profileState.avatarDataUrl || DEFAULT_AVATAR_SRC;

  if (elements.topbarDisplayName) {
    elements.topbarDisplayName.textContent = profileState.displayName;
  }
  if (elements.menuDisplayName) {
    elements.menuDisplayName.textContent = profileState.displayName;
  }
  if (elements.menuUsername) {
    elements.menuUsername.textContent = `@${profileState.username}`;
  }

  [elements.topbarAvatar, elements.menuAvatar, elements.avatarPreview].forEach((image) => {
    if (image) {
      image.src = avatarSrc;
    }
  });

  if (options.persist) {
    writeStoredProfile(profileState);
  }
}

function mapUserToProfile(user = {}) {
  return {
    displayName: normalizeDisplayName(user.nickname || user.username || "Workflow Points"),
    username: normalizeUsername(user.username || "workflow_points"),
    avatarDataUrl: String(user.avatar_img || ""),
    phone: normalizePhone(user.phone || ""),
    address: normalizeAddress(user.address || ""),
  };
}

function seedProfileFromAccount(pointAccount = {}) {
  const storedProfile = readStoredProfile();
  renderProfile(
    {
      ...mapUserToProfile(pointAccount),
      avatarDataUrl: pointAccount.avatar_img || storedProfile?.avatarDataUrl || "",
    },
    { persist: true },
  );
}

function closeProfileMenu() {
  const elements = getProfileElements();
  if (!elements.menuRoot || !elements.menuTrigger || !elements.menuDropdown) {
    return;
  }

  elements.menuRoot.classList.remove("is-open");
  elements.menuTrigger.setAttribute("aria-expanded", "false");
  elements.menuDropdown.setAttribute("aria-hidden", "true");
}

function openProfileMenu() {
  const elements = getProfileElements();
  if (!elements.menuRoot || !elements.menuTrigger || !elements.menuDropdown) {
    return;
  }

  elements.menuRoot.classList.add("is-open");
  elements.menuTrigger.setAttribute("aria-expanded", "true");
  elements.menuDropdown.setAttribute("aria-hidden", "false");
}

function syncProfileForm() {
  const elements = getProfileElements();
  if (!elements.form) {
    return;
  }

  const nextProfile = resolveProfileState();
  pendingAvatarDataUrl = nextProfile.avatarDataUrl || "";
  pendingAvatarFile = null;

  if (elements.displayNameInput) {
    elements.displayNameInput.value = nextProfile.displayName;
  }
  if (elements.usernameInput) {
    elements.usernameInput.value = nextProfile.username;
  }
  if (elements.phoneInput) {
    elements.phoneInput.value = nextProfile.phone;
  }
  if (elements.addressInput) {
    elements.addressInput.value = nextProfile.address;
  }
  if (elements.avatarPreview) {
    elements.avatarPreview.src = pendingAvatarDataUrl || DEFAULT_AVATAR_SRC;
  }
  if (elements.avatarInput) {
    elements.avatarInput.value = "";
  }
  if (elements.formError) {
    elements.formError.hidden = true;
    elements.formError.textContent = "";
  }
}

async function uploadProfileAvatar(file) {
  const token = getToken();
  const formData = new FormData();
  formData.append("avatar", file);

  const response = await fetch(`${API_BASE}/api/v1/profile/avatar`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.detail || `Avatar upload failed: ${response.status}`);
  }

  return data;
}

async function saveProfile(payload) {
  return requestJson("/api/v1/profile", {
    method: "PATCH",
    body: JSON.stringify({
      nickname: payload.displayName,
      username: payload.username,
      phone: payload.phone || null,
      address: payload.address || null,
    }),
  });
}

function openProfileModal() {
  const elements = getProfileElements();
  if (!elements.modal) {
    return;
  }

  syncProfileForm();
  elements.modal.classList.add("is-open");
  elements.modal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => elements.displayNameInput?.focus(), 10);
}

function closeProfileModal() {
  const elements = getProfileElements();
  if (!elements.modal) {
    return;
  }

  elements.modal.classList.remove("is-open");
  elements.modal.setAttribute("aria-hidden", "true");
}

function attachProfileControls() {
  const elements = getProfileElements();
  if (!elements.menuTrigger || !elements.form) {
    return;
  }

  renderProfile(readStoredProfile() || getProfileDefaults());

  elements.menuTrigger.addEventListener("click", (event) => {
    event.stopPropagation();
    if (elements.menuRoot?.classList.contains("is-open")) {
      closeProfileMenu();
      return;
    }
    openProfileMenu();
  });

  elements.editButton?.addEventListener("click", () => {
    closeProfileMenu();
    openProfileModal();
  });

  elements.avatarUpload?.addEventListener("click", () => {
    elements.avatarInput?.click();
  });

  elements.avatarInput?.addEventListener("change", () => {
    const file = elements.avatarInput?.files?.[0];
    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      if (elements.formError) {
        elements.formError.hidden = false;
        elements.formError.textContent = "请选择图片文件作为头像。";
      }
      return;
    }

    pendingAvatarFile = file;
    const reader = new FileReader();
    reader.onload = () => {
      pendingAvatarDataUrl = typeof reader.result === "string" ? reader.result : "";
      if (elements.avatarPreview) {
        elements.avatarPreview.src = pendingAvatarDataUrl || DEFAULT_AVATAR_SRC;
      }
      if (elements.formError) {
        elements.formError.hidden = true;
        elements.formError.textContent = "";
      }
    };
    reader.readAsDataURL(file);
  });

  elements.form.addEventListener("submit", (event) => {
    event.preventDefault();

    const displayName = normalizeDisplayName(elements.displayNameInput?.value);
    const username = normalizeUsername(elements.usernameInput?.value).toLowerCase();

    if (!displayName) {
      elements.formError.hidden = false;
      elements.formError.textContent = "请输入昵称。";
      elements.displayNameInput?.focus();
      return;
    }

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      elements.formError.hidden = false;
      elements.formError.textContent = "用户名需为 3-24 位，只能包含字母、数字、下划线。";
      elements.usernameInput?.focus();
      return;
    }

    renderProfile(
      {
        displayName,
        username,
        avatarDataUrl: pendingAvatarDataUrl || profileState?.avatarDataUrl || "",
      },
      { persist: true },
    );
    closeProfileModal();
  });

  elements.avatarInput?.addEventListener(
    "change",
    (event) => {
      event.stopImmediatePropagation();

      const file = elements.avatarInput?.files?.[0];
      if (!file) {
        return;
      }

      if (!file.type.startsWith("image/")) {
        if (elements.formError) {
          elements.formError.hidden = false;
          elements.formError.textContent = "Please choose an image file for the avatar.";
        }
        return;
      }

      pendingAvatarFile = file;

      const reader = new FileReader();
      reader.onload = () => {
        pendingAvatarDataUrl = typeof reader.result === "string" ? reader.result : "";
        if (elements.avatarPreview) {
          elements.avatarPreview.src = pendingAvatarDataUrl || DEFAULT_AVATAR_SRC;
        }
        if (elements.formError) {
          elements.formError.hidden = true;
          elements.formError.textContent = "";
        }
      };
      reader.readAsDataURL(file);
    },
    true,
  );

  elements.form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      const displayName = normalizeDisplayName(elements.displayNameInput?.value);
      const username = normalizeUsername(elements.usernameInput?.value).toLowerCase();
      const phone = normalizePhone(elements.phoneInput?.value);
      const address = normalizeAddress(elements.addressInput?.value);

      if (!displayName) {
        elements.formError.hidden = false;
        elements.formError.textContent = "Please enter a nickname.";
        elements.displayNameInput?.focus();
        return;
      }

      if (!/^[a-z0-9_]{3,24}$/.test(username)) {
        elements.formError.hidden = false;
        elements.formError.textContent =
          "用户名需为 3-24 位，只能包含字母、数字、下划线。";
        elements.usernameInput?.focus();
        return;
      }

      const originalText = elements.submitButton?.textContent || "Save";
      if (elements.submitButton) {
        elements.submitButton.disabled = true;
        elements.submitButton.textContent = "Saving...";
      }

      try {
        if (pendingAvatarFile) {
          const avatarResult = await uploadProfileAvatar(pendingAvatarFile);
          pendingAvatarDataUrl =
            avatarResult.avatar_img || avatarResult.avatar_url || pendingAvatarDataUrl;
        }

        const savedUser = await saveProfile({
          displayName,
          username,
          phone,
          address,
        });

        renderProfile(
          {
            ...mapUserToProfile(savedUser),
            avatarDataUrl:
              savedUser.avatar_img ||
              pendingAvatarDataUrl ||
              profileState?.avatarDataUrl ||
              "",
          },
          { persist: true },
        );
        closeProfileModal();
      } catch (error) {
        elements.formError.hidden = false;
        elements.formError.textContent =
          error.message || "Failed to save profile.";
      } finally {
        if (elements.submitButton) {
          elements.submitButton.disabled = false;
          elements.submitButton.textContent = originalText;
        }
      }
    },
    true,
  );

  [elements.modalClose, elements.modalCancel, elements.modalBackdrop].forEach((node) => {
    node?.addEventListener("click", () => {
      closeProfileModal();
    });
  });

  document.addEventListener("click", (event) => {
    if (!elements.menuRoot?.contains(event.target)) {
      closeProfileMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    closeProfileMenu();
    closeProfileModal();
  });
}

function logout() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_STORAGE_KEY);
  window.location.href = resolveAuthEntryUrl();
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.auth === false ? {} : getAuthHeaders()),
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.detail || `请求失败: ${response.status}`);
  }

  return data;
}

function syncAccountView(pointAccount) {
  setText("availablePoints", formatNumber(pointAccount.available_points));
  setText("frozenPoints", formatNumber(pointAccount.frozen_points));
  setText("todayRuns", formatNumber(pointAccount.today_runs));
  setText("todaySpent", formatPoints(pointAccount.today_spent_points));
  setText("sidebarAvailablePoints", formatNumber(pointAccount.available_points));
  setText("sidebarFrozenPoints", formatNumber(pointAccount.frozen_points));
  setText("sidebarTodayRuns", formatNumber(pointAccount.today_runs));
  setText("sidebarTodaySpent", formatPoints(pointAccount.today_spent_points));
  setText("mobileAvailablePoints", formatNumber(pointAccount.available_points));
  setText("mobileTodayRuns", formatNumber(pointAccount.today_runs));
  setText("mobileTodaySpent", formatPoints(pointAccount.today_spent_points));
  setText("userId", pointAccount.user_id ?? "-");
  setText("accountDiscount", "1.00");
  setText("lastRechargeAt", pointAccount.total_recharged_points > 0 ? "已有充值记录" : "-");
  setText("totalRechargedPoints", formatNumber(pointAccount.total_recharged_points));
  setText("totalConsumedPoints", formatNumber(pointAccount.total_consumed_points));
  setText("availablePointsMirror", formatNumber(pointAccount.available_points));
  setText("frozenPointsMirror", formatNumber(pointAccount.frozen_points));
}

function renderWorkflows(workflows) {
  const workflowGrid = document.getElementById("workflowGrid");
  workflowGrid.innerHTML = workflows
    .map(
      (workflow) => `
        <article class="workflow-card">
          <div class="workflow-header">
            <div>
              <p class="eyebrow">${workflow.workflow_code}</p>
              <h4>${workflow.workflow_name}</h4>
            </div>
            <span class="workflow-status">${workflow.current_status}</span>
          </div>
          <p class="workflow-description">${workflow.description || "-"}</p>
          <div class="workflow-meta">
            <p>计费模式: <span>${workflow.metering_mode}</span></p>
            <p>计费口径: <span>${workflow.base_points ? `${workflow.base_points} 积分 / 次` : (workflow.unit_points ? `${workflow.unit_points} 积分 / 张` : '-')}</span></p>
          </div>
          <div class="workflow-footer">
            <p class="status-line">
              ${
                workflow.workflow_code === "WF-001"
                  ? "进入表单页填写提示词，执行完成后展示图片结果。"
                  : workflow.workflow_code === "WF-003"
                    ? "上传外观图和内饰图，先按预估张数冻结，再按实际完成张数结算。"
                    : "先 register 预冻结，再由工作流 callback 结算。"
              }
            </p>
            <button class="primary-button" type="button" data-workflow-code="${workflow.workflow_code}">
              进入
            </button>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderRecords(workflowRuns, filter = "all") {
  latestRecordFilter = filter;
  const rows = workflowRuns.filter((record) => filter === "all" || record.status === filter);
  const recordsBody = document.getElementById("recordsBody");
  const mobileRecords = document.getElementById("mobileRecords");
  const resolveRecordTime = (record) => record.finished_at || record.started_at || record.created_at;

  recordsBody.innerHTML = rows
    .map(
      (record) => `
        <tr>
          <td>${record.run_id}</td>
          <td>${record.workflow_code}</td>
          <td><span class="status-pill status-${record.status}">${statusTextMap[record.status] ?? record.status}</span></td>
          <td>${formatNumber(record.estimated_frozen_points)}</td>
          <td>${formatNumber(record.final_charge_points)}</td>
          <td>${formatDateTime(resolveRecordTime(record))}</td>
        </tr>
      `,
    )
    .join("");

  mobileRecords.innerHTML = rows
    .map(
      (record) => `
        <article class="mobile-record-card">
          <div class="mobile-record-top">
            <strong>${record.workflow_code}</strong>
            <span class="status-pill status-${record.status}">${statusTextMap[record.status] ?? record.status}</span>
          </div>
          <div class="mobile-record-main">
            <p>${record.result_summary ?? "-"}</p>
          </div>
          <div class="mobile-record-meta">
            <span><strong>run_id</strong> ${record.run_id}</span>
            <span><strong>billing_status</strong> ${billingStatusTextMap[record.billing_status] ?? record.billing_status}</span>
            <span><strong>estimated_frozen_points</strong> ${formatNumber(record.estimated_frozen_points)}</span>
            <span><strong>final_charge_points</strong> ${formatNumber(record.final_charge_points)}</span>
          </div>
          <span class="mobile-record-time">${formatDateTime(resolveRecordTime(record))}</span>
        </article>
      `,
    )
    .join("");
}

function buildLedgerRowsFromRuns(workflowRuns) {
  return workflowRuns.flatMap((record) => {
    const entries = [];

    if (Number(record.estimated_frozen_points) > 0) {
      entries.push({
        ledger_no: `${record.run_id}-freeze`,
        change_points: -Number(record.estimated_frozen_points),
        workflow_code: record.workflow_code,
        remark: `${record.workflow_code} 预冻结 ${record.estimated_frozen_points} 积分`,
        ledger_type: "freeze",
        created_at: record.started_at,
      });
    }

    if (record.billing_status === "charged") {
      entries.push({
        ledger_no: `${record.run_id}-charge`,
        change_points: -Number(record.final_charge_points),
        workflow_code: record.workflow_code,
        remark: `${record.workflow_code} 正式扣费 ${record.final_charge_points} 积分`,
        ledger_type: "charge",
        created_at: record.finished_at,
      });
    }

    if (Number(record.refund_points) > 0) {
      entries.push({
        ledger_no: `${record.run_id}-rollback`,
        change_points: Number(record.refund_points),
        workflow_code: record.workflow_code,
        remark: `${record.workflow_code} 回滚 ${record.refund_points} 积分`,
        ledger_type: "rollback",
        created_at: record.finished_at,
      });
    }

    return entries;
  });
}

function renderLedgers(workflowRuns) {
  const ledgerList = document.getElementById("ledgerList");
  const entries = buildLedgerRowsFromRuns(workflowRuns);

  ledgerList.innerHTML = entries.length
    ? entries
        .map(
          (entry) => `
            <article class="ledger-item">
              <div class="ledger-top">
                <strong>${entry.ledger_no}</strong>
                <strong class="ledger-change ${entry.change_points > 0 ? "positive" : "negative"}">
                  ${entry.change_points > 0 ? "+" : ""}${entry.change_points} 积分
                </strong>
              </div>
              <p>${entry.remark}</p>
              <span>${entry.ledger_type} · ${entry.workflow_code} · ${formatDateTime(entry.created_at)}</span>
            </article>
          `,
        )
        .join("")
    : '<article class="ledger-item"><p>当前还没有积分流水记录。</p></article>';
}

// function renderApiContracts() {
//   const apiContractList = document.getElementById("apiContractList");
//   apiContractList.innerHTML = apiContracts
//     .map(
//       (contract) => `
//         <article class="contract-card">
//           <div class="contract-head">
//             <strong>${contract.endpoint}</strong>
//             <span>${contract.purpose}</span>
//           </div>
//           <div class="field-chip-list">
//             ${contract.fields.map((field) => `<span class="field-chip">${field}</span>`).join("")}
//           </div>
//         </article>
//       `,
//     )
//     .join("");
// }

function renderConnectionState(message, isError = false) {
  setText("userId", isError ? "未连接" : "已连接");
  setText("accountDiscount", isError ? "-" : "1.00");
  setText("lastRechargeAt", message);
}

function attachRecordFilter(workflowRuns) {
  const filterRoot = document.getElementById("recordFilters");
  if (!filterRoot) {
    return;
  }

  filterRoot.addEventListener("click", (event) => {
    const button = event.target.closest("[data-filter]");
    if (!button) {
      return;
    }

    document.querySelectorAll(".chip").forEach((chip) => chip.classList.remove("is-active"));
    button.classList.add("is-active");
    renderRecords(latestWorkflowRuns, button.dataset.filter);
  });
}

function attachWorkflowButtons() {
  const workflowGrid = document.getElementById("workflowGrid");
  if (!workflowGrid) {
    return;
  }

  workflowGrid.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-workflow-code]");
    if (!button) {
      return;
    }

    const workflowCode = button.dataset.workflowCode;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "处理中...";

    try {
      if (workflowCode === "WF-003") {
        const token = getToken();
        const wf003Url = new URL(resolveWf003PortalUrl());
        if (token) {
          wf003Url.searchParams.set("token", token);
        }
        window.open(wf003Url.toString(), "_blank", "noopener,noreferrer");
        button.disabled = false;
        button.textContent = originalText;
        return;
      }

      if (workflowCode === "WF-001" || workflowCode === "WF-002") {
        const token = getToken();
        const pageName =
          workflowCode === "WF-001"
            ? "wf001.html"
            : "wf002.html";
        const targetUrl = token
          ? `./${pageName}?token=${encodeURIComponent(token)}`
          : `./${pageName}`;
        window.open(targetUrl, "_blank", "noopener,noreferrer");
        button.disabled = false;
        button.textContent = originalText;
        return;
      }

      const result = await requestJson("/api/v1/workflow-runs/register", {
        method: "POST",
        body: JSON.stringify({
          workflow_code: workflowCode,
          client_request_id: `portal_${workflowCode}_${Date.now()}`,
          request_payload_summary: {
            source: "client_portal",
          },
        }),
      });

      alert(`登记成功\nrun_id: ${result.run_id}\n冻结积分: ${result.estimated_frozen_points}`);
      window.location.reload();
    } catch (error) {
      alert(`执行失败: ${error.message}`);
      button.disabled = false;
      button.textContent = originalText;
    }
  });
}

function attachLogoutButton() {
  const logoutButtons = document.querySelectorAll("#logoutButton, #profileLogoutButton");
  if (!logoutButtons.length) {
    return;
  }

  logoutButtons.forEach((button) => {
    button.addEventListener("click", logout);
  });
}

async function refreshDashboardData() {
  const [pointAccount, workflowRuns] = await Promise.all([
    requestJson("/api/v1/point-accounts/me"),
    requestJson("/api/v1/workflow-runs"),
  ]);

  latestWorkflowRuns = workflowRuns;
  syncAccountView(pointAccount);
  renderRecords(workflowRuns, latestRecordFilter);
  renderLedgers(workflowRuns);
}

function startAutoRefresh() {
  if (refreshTimer) {
    window.clearInterval(refreshTimer);
  }

  refreshTimer = window.setInterval(async () => {
    if (document.hidden) {
      return;
    }

    try {
      await refreshDashboardData();
    } catch (error) {
      console.error("refresh dashboard failed", error);
    }
  }, 10000);
}

async function bootstrap() {
  // renderApiContracts();
  syncAccountView(fallbackPointAccount);
  renderRecords([]);
  renderLedgers([]);
  attachProfileControls();
  attachLogoutButton();

  try {
    const [currentUser, pointAccount, workflows, workflowRuns] = await Promise.all([
      requestJson("/me"),
      requestJson("/api/v1/point-accounts/me"),
      requestJson("/api/v1/workflows"),
      requestJson("/api/v1/workflow-runs"),
    ]);

    latestWorkflowRuns = workflowRuns;
    syncAccountView(pointAccount);
    seedProfileFromAccount(currentUser);
    renderWorkflows(workflows);
    renderRecords(workflowRuns);
    renderLedgers(workflowRuns);
    renderConnectionState(`账号 ${pointAccount.username || pointAccount.user_id} 已连接中台`, false);
    attachRecordFilter(workflowRuns);
    attachWorkflowButtons();
    startAutoRefresh();
  } catch (error) {
    renderWorkflows([]);
    renderConnectionState(error.message, true);
    console.error(error);
    alert(`中台数据加载失败: ${error.message}\n请确认已登录、NestJS 已启动，并且 token 仍然有效。`);
  }
}

bootstrap();
