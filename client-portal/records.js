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
let refreshTimer = null;

const recordQuery = {
  startTime: "",
  endTime: "",
  status: "all",
  orderNo: "",
};

const recordPagination = {
  page: 1,
  pageSize: 20,
  total: 0,
};

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

const fallbackPointAccount = {
  user_id: "-",
  available_points: 0,
  frozen_points: 0,
  today_runs: 0,
  today_spent_points: 0,
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
    throw new Error("未找到有效 token，请先登录后重试");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function logout() {
  window.localStorage.removeItem(TOKEN_KEY);
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
  setText("sidebarAvailablePoints", formatNumber(pointAccount.available_points));
  setText("sidebarFrozenPoints", formatNumber(pointAccount.frozen_points));
  setText("mobileAvailablePoints", formatNumber(pointAccount.available_points));
  setText("mobileTodayRuns", formatNumber(pointAccount.today_runs));
  setText("mobileTodaySpent", formatNumber(pointAccount.today_spent_points));
  setText("userId", pointAccount.user_id ?? "-");
  setText("accountDiscount", "1.00");
}

function buildPageNumberList(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    pages.push("...");
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (end < totalPages - 1) {
    pages.push("...");
  }

  pages.push(totalPages);
  return pages;
}

function renderPaginationUi() {
  const totalPages = Math.max(1, Math.ceil(recordPagination.total / recordPagination.pageSize));
  const totalCountNode = document.getElementById("recordTotalCount");
  const pageInfoNode = document.getElementById("recordPageInfo");
  const prevPageButton = document.getElementById("recordPrevPage");
  const nextPageButton = document.getElementById("recordNextPage");
  const pageNumbersNode = document.getElementById("recordPageNumbers");

  if (totalCountNode) {
    totalCountNode.textContent = `共 ${formatNumber(recordPagination.total)} 条`;
  }

  if (pageInfoNode) {
    pageInfoNode.textContent = `${recordPagination.page} / ${totalPages}`;
  }

  if (prevPageButton) {
    prevPageButton.disabled = recordPagination.page <= 1;
  }

  if (nextPageButton) {
    nextPageButton.disabled = recordPagination.page >= totalPages;
  }

  if (pageNumbersNode) {
    const pageList = buildPageNumberList(recordPagination.page, totalPages);
    pageNumbersNode.innerHTML = pageList
      .map((item) => {
        if (item === "...") {
          return '<span class="record-page-ellipsis">...</span>';
        }

        const activeClass = item === recordPagination.page ? " is-active" : "";
        return `<button type="button" class="record-page-number${activeClass}" data-page="${item}">${item}</button>`;
      })
      .join("");
  }
}

function renderRecords(rows = []) {
  const recordsBody = document.getElementById("recordsBody");
  const mobileRecords = document.getElementById("mobileRecords");

  if (recordsBody) {
    recordsBody.innerHTML = rows.length
      ? rows
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
          .join("")
      : '<tr><td colspan="6">暂无符合条件的调用记录</td></tr>';
  }

  if (mobileRecords) {
    mobileRecords.innerHTML = rows.length
      ? rows
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
          .join("")
      : '<article class="mobile-record-card"><p>暂无符合条件的调用记录</p></article>';
  }

  renderPaginationUi();
}

function buildQueryString() {
  const params = new URLSearchParams();
  params.set("page", String(recordPagination.page));
  params.set("page_size", String(recordPagination.pageSize));

  if (recordQuery.startTime) {
    params.set("start_time", recordQuery.startTime);
  }
  if (recordQuery.endTime) {
    params.set("end_time", recordQuery.endTime);
  }
  if (recordQuery.status && recordQuery.status !== "all") {
    params.set("status", recordQuery.status);
  }
  if (recordQuery.orderNo) {
    params.set("order_no", recordQuery.orderNo);
  }

  return params.toString();
}

async function fetchRecordRows() {
  const queryString = buildQueryString();
  const result = await requestJson(`/api/v1/workflow-runs/query?${queryString}`);
  recordPagination.total = Number(result?.total ?? 0);
  recordPagination.page = Number(result?.page ?? recordPagination.page);
  recordPagination.pageSize = Number(result?.page_size ?? recordPagination.pageSize);
  return Array.isArray(result?.items) ? result.items : [];
}

async function refreshRecordList() {
  const rows = await fetchRecordRows();
  renderRecords(rows);
}

function attachRecordControls() {
  const startTimeInput = document.getElementById("recordStartTime");
  const endTimeInput = document.getElementById("recordEndTime");
  const statusSelect = document.getElementById("recordStatus");
  const orderNoInput = document.getElementById("recordOrderNo");
  const searchButton = document.getElementById("recordSearchButton");
  const resetButton = document.getElementById("recordResetButton");
  const pageSizeSelect = document.getElementById("recordPageSize");
  const prevPageButton = document.getElementById("recordPrevPage");
  const nextPageButton = document.getElementById("recordNextPage");
  const pageNumbersNode = document.getElementById("recordPageNumbers");

  if (searchButton) {
    searchButton.addEventListener("click", async () => {
      recordQuery.startTime = startTimeInput?.value || "";
      recordQuery.endTime = endTimeInput?.value || "";
      recordQuery.status = statusSelect?.value || "all";
      recordQuery.orderNo = (orderNoInput?.value || "").trim();
      recordPagination.page = 1;
      await refreshRecordList();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      if (startTimeInput) startTimeInput.value = "";
      if (endTimeInput) endTimeInput.value = "";
      if (statusSelect) statusSelect.value = "all";
      if (orderNoInput) orderNoInput.value = "";

      recordQuery.startTime = "";
      recordQuery.endTime = "";
      recordQuery.status = "all";
      recordQuery.orderNo = "";
      recordPagination.page = 1;
      await refreshRecordList();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.value = String(recordPagination.pageSize);
    pageSizeSelect.addEventListener("change", async (event) => {
      recordPagination.pageSize = Number(event.target.value) || 20;
      recordPagination.page = 1;
      await refreshRecordList();
    });
  }

  if (prevPageButton) {
    prevPageButton.addEventListener("click", async () => {
      if (recordPagination.page <= 1) {
        return;
      }

      recordPagination.page -= 1;
      await refreshRecordList();
    });
  }

  if (nextPageButton) {
    nextPageButton.addEventListener("click", async () => {
      const totalPages = Math.max(1, Math.ceil(recordPagination.total / recordPagination.pageSize));
      if (recordPagination.page >= totalPages) {
        return;
      }

      recordPagination.page += 1;
      await refreshRecordList();
    });
  }

  if (pageNumbersNode) {
    pageNumbersNode.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-page]");
      if (!button) {
        return;
      }

      const targetPage = Number(button.dataset.page);
      if (!Number.isFinite(targetPage) || targetPage === recordPagination.page) {
        return;
      }

      recordPagination.page = targetPage;
      await refreshRecordList();
    });
  }
}

function attachLogoutButton() {
  const logoutButton = document.getElementById("logoutButton");
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener("click", logout);
}

async function refreshData() {
  const [pointAccount] = await Promise.all([
    requestJson("/api/v1/point-accounts/me"),
    refreshRecordList(),
  ]);

  syncAccountView(pointAccount);
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
      await refreshData();
    } catch (error) {
      console.error("refresh records failed", error);
    }
  }, 10000);
}

async function bootstrap() {
  syncAccountView(fallbackPointAccount);
  renderRecords([]);
  attachRecordControls();
  attachLogoutButton();

  try {
    await refreshData();
    startAutoRefresh();
  } catch (error) {
    console.error(error);
    alert(`调用记录加载失败: ${error.message}`);
  }
}

bootstrap();