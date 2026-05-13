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
const THEME_KEY = "client_portal_theme";

const pagination = {
  page: 1,
  pageSize: 20,
  total: 0,
};

const statusTextMap = {
  success: "成功",
  running: "生成中",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
};

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

function initTheme() {
  try {
    applyTheme(window.localStorage.getItem(THEME_KEY) || "light");
  } catch {
    applyTheme("light");
  }
}

function getToken() {
  if (window.ClientPortalAuth) {
    return window.ClientPortalAuth.readToken();
  }
  return "";
}

function redirectToLogin() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.redirectToLogin();
    return;
  }

  window.localStorage.removeItem(TOKEN_KEY);
  window.location.replace(resolveAuthEntryUrl());
}

function buildHeaders() {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new Error("请先登录后再查看 WF-001 历史记录。");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

async function requestJson(path, options = {}) {
  const requestOptions = {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };
  const response = window.ClientPortalAuth
    ? await window.ClientPortalAuth.authFetch(path, requestOptions)
    : await fetch(`${API_BASE}${path}`, {
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          ...(options.auth === false ? {} : buildHeaders()),
        },
      });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401 && options.auth !== false) {
      redirectToLogin();
      throw new Error("登录已过期，请重新登录");
    }
    throw new Error(data?.message || data?.detail || `请求失败: ${response.status}`);
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#96;");
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("zh-CN");
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

function resolveRecordTime(record) {
  return record.finished_at || record.started_at || record.created_at || null;
}

function getRequestSummary(record) {
  const summary = record?.request_payload_summary;
  return summary && typeof summary === "object" ? summary : {};
}

function getPrompt(record) {
  const summary = getRequestSummary(record);
  return (
    summary.prompt ||
    summary.prompt_preview ||
    "未记录提示词"
  );
}

function getStatusText(record) {
  return statusTextMap[record?.status] || record?.status || "未知";
}

function renderStatus(record) {
  const status = String(record?.status || "unknown");
  return `<span class="status-pill status-${escapeAttribute(status)}">${escapeHtml(getStatusText(record))}</span>`;
}

function getChargePoints(record) {
  return Number(record.final_charge_points ?? record.estimated_frozen_points ?? 0);
}

function getImageUrls(record) {
  return Array.isArray(record.result_urls) ? record.result_urls.filter(Boolean) : [];
}

function renderImageLinks(record) {
  const urls = getImageUrls(record);
  if (!urls.length) {
    return '<span class="wf-muted">暂无图片链接</span>';
  }

  return `
    <div class="wf-image-links">
      ${urls
        .map(
          (url, index) => `
            <a class="wf-image-link" href="${escapeAttribute(url)}" target="_blank" rel="noreferrer" data-preview-url="${escapeAttribute(url)}" data-preview-label="图片 ${index + 1}">图片 ${index + 1}</a>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRows(rows) {
  const recordsBody = document.getElementById("recordsBody");
  const mobileRecords = document.getElementById("mobileRecords");

  if (recordsBody) {
    recordsBody.innerHTML = rows.length
      ? rows
          .map(
            (record) => `
              <tr>
                <td>${escapeHtml(record.run_id || "-")}</td>
                <td>${renderStatus(record)}</td>
                <td><p class="wf-description wf-prompt-text">${escapeHtml(getPrompt(record))}</p></td>
                <td>${renderImageLinks(record)}</td>
                <td>${formatNumber(getChargePoints(record))}</td>
                <td>${formatDateTime(resolveRecordTime(record))}</td>
              </tr>
            `,
          )
          .join("")
      : '<tr><td colspan="6"><div class="wf-empty">暂无 WF-001 生成记录</div></td></tr>';
  }

  if (mobileRecords) {
    mobileRecords.innerHTML = rows.length
      ? rows
          .map(
            (record) => `
              <article class="wf-mobile-record">
                <div class="wf-mobile-record-top">
                  <strong>${escapeHtml(record.run_id || "-")}</strong>
                  ${renderStatus(record)}
                </div>
                <dl>
                  <div>
                    <dt>消耗积分</dt>
                    <dd>${formatNumber(getChargePoints(record))} 积分</dd>
                  </div>
                  <div>
                    <dt>提示词</dt>
                    <dd class="wf-prompt-text">${escapeHtml(getPrompt(record))}</dd>
                  </div>
                  <div>
                    <dt>详情（图片链接）</dt>
                    <dd>${renderImageLinks(record)}</dd>
                  </div>
                  <div>
                    <dt>时间</dt>
                    <dd>${formatDateTime(resolveRecordTime(record))}</dd>
                  </div>
                </dl>
              </article>
            `,
          )
          .join("")
      : '<article class="wf-mobile-record"><p class="wf-muted">暂无 WF-001 生成记录</p></article>';
  }
}

function getPreviewPopover() {
  let popover = document.getElementById("wfImagePreviewPopover");
  if (popover) {
    return popover;
  }

  popover = document.createElement("div");
  popover.id = "wfImagePreviewPopover";
  popover.className = "wf-preview-popover";
  popover.setAttribute("aria-hidden", "true");
  popover.innerHTML = '<img alt="" /><span></span>';
  document.body.appendChild(popover);
  return popover;
}

function positionPreviewPopover(anchor, popover) {
  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth || 220;
  const height = popover.offsetHeight || 292;
  const margin = 12;
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - width / 2, margin),
    window.innerWidth - width - margin,
  );
  const hasSpaceAbove = rect.top > height + margin;
  const top = hasSpaceAbove
    ? rect.top - height - 10
    : Math.min(rect.bottom + 10, window.innerHeight - height - margin);

  popover.style.left = `${left}px`;
  popover.style.top = `${Math.max(margin, top)}px`;
}

function showImagePreview(anchor) {
  const url = anchor?.dataset?.previewUrl;
  if (!url) {
    return;
  }

  const popover = getPreviewPopover();
  const image = popover.querySelector("img");
  const label = popover.querySelector("span");

  if (image) {
    image.src = url;
  }
  if (label) {
    label.textContent = anchor.dataset.previewLabel || "图片预览";
  }

  positionPreviewPopover(anchor, popover);
  popover.classList.add("is-visible");
}

function hideImagePreview() {
  const popover = document.getElementById("wfImagePreviewPopover");
  if (!popover) {
    return;
  }

  popover.classList.remove("is-visible");
}

function bindImagePreview() {
  document.addEventListener("mouseover", (event) => {
    const anchor = event.target.closest("[data-preview-url]");
    if (anchor) {
      showImagePreview(anchor);
    }
  });

  document.addEventListener("mousemove", (event) => {
    const anchor = event.target.closest("[data-preview-url]");
    const popover = document.getElementById("wfImagePreviewPopover");
    if (anchor && popover?.classList.contains("is-visible")) {
      positionPreviewPopover(anchor, popover);
    }
  });

  document.addEventListener("mouseout", (event) => {
    const anchor = event.target.closest("[data-preview-url]");
    if (anchor && !anchor.contains(event.relatedTarget)) {
      hideImagePreview();
    }
  });

  document.addEventListener("focusin", (event) => {
    const anchor = event.target.closest("[data-preview-url]");
    if (anchor) {
      showImagePreview(anchor);
    }
  });

  document.addEventListener("focusout", (event) => {
    const anchor = event.target.closest("[data-preview-url]");
    if (anchor) {
      hideImagePreview();
    }
  });
}

function renderPagination() {
  const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
  const totalCount = document.getElementById("recordTotalCount");
  const pageInfo = document.getElementById("pageInfo");
  const prevButton = document.getElementById("prevPageButton");
  const nextButton = document.getElementById("nextPageButton");

  if (totalCount) {
    totalCount.textContent = `共 ${formatNumber(pagination.total)} 条`;
  }
  if (pageInfo) {
    pageInfo.textContent = `${pagination.page} / ${totalPages}`;
  }
  if (prevButton) {
    prevButton.disabled = pagination.page <= 1;
  }
  if (nextButton) {
    nextButton.disabled = pagination.page >= totalPages;
  }
}

async function fetchRecords() {
  const params = new URLSearchParams({
    page: String(pagination.page),
    page_size: String(pagination.pageSize),
    workflow_code: "WF-001",
  });
  const result = await requestJson(`/api/v1/workflow-runs/query?${params.toString()}`);
  pagination.total = Number(result?.total ?? 0);
  pagination.page = Number(result?.page ?? pagination.page);
  pagination.pageSize = Number(result?.page_size ?? pagination.pageSize);
  return Array.isArray(result?.items)
    ? result.items.filter((record) => record?.workflow_code === "WF-001")
    : [];
}

async function refreshRecords() {
  const rows = await fetchRecords();
  renderRows(rows);
  renderPagination();
}

function bindControls() {
  const refreshButton = document.getElementById("refreshButton");
  const prevButton = document.getElementById("prevPageButton");
  const nextButton = document.getElementById("nextPageButton");

  refreshButton?.addEventListener("click", refreshRecords);

  prevButton?.addEventListener("click", async () => {
    if (pagination.page <= 1) {
      return;
    }
    pagination.page -= 1;
    await refreshRecords();
  });

  nextButton?.addEventListener("click", async () => {
    const totalPages = Math.max(1, Math.ceil(pagination.total / pagination.pageSize));
    if (pagination.page >= totalPages) {
      return;
    }
    pagination.page += 1;
    await refreshRecords();
  });
}

function buildLinks() {
  const wf001Link = document.getElementById("wf001Link");
  const portalLink = document.getElementById("portalLink");

  if (wf001Link) {
    wf001Link.href = "./wf001.html";
  }
  if (portalLink) {
    portalLink.href = "./index.html";
  }
}

async function bootstrap() {
  try {
    initTheme();
    await window.ClientPortalAuth?.ensureAuthenticated();
    buildLinks();
    bindControls();
    bindImagePreview();
    renderRows([]);
    renderPagination();
    await refreshRecords();
  } catch (error) {
    if (error.message === "登录已过期，请重新登录") {
      return;
    }
    window.alert(`WF-001 历史记录加载失败：${error.message}`);
  }
}

bootstrap();
