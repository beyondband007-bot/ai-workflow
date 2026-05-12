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

const ledgerQuery = {
  startTime: "",
  endTime: "",
  ledgerType: "all",
  keyword: "",
};

const ledgerPagination = {
  page: 1,
  pageSize: 20,
  total: 0,
};

const ledgerTypeTextMap = {
  freeze: "冻结",
  charge: "扣费",
  rollback: "回滚",
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

function resolveRunTime(record) {
  return record.finished_at || record.started_at || record.created_at || null;
}

function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
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

function redirectToLogin() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.redirectToLogin();
    return;
  }

  window.localStorage.removeItem(TOKEN_KEY);
  window.location.replace(resolveAuthEntryUrl());
}

function getAuthHeaders() {
  const token = getToken();
  if (!token) {
    redirectToLogin();
    throw new Error("请先登录");
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}

function logout() {
  redirectToLogin();
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
    if (response.status === 401 && options.auth !== false) {
      redirectToLogin();
      throw new Error("登录已过期，请重新登录");
    }
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
  const totalPages = Math.max(1, Math.ceil(ledgerPagination.total / ledgerPagination.pageSize));
  const totalCountNode = document.getElementById("ledgerTotalCount");
  const pageInfoNode = document.getElementById("ledgerPageInfo");
  const prevPageButton = document.getElementById("ledgerPrevPage");
  const nextPageButton = document.getElementById("ledgerNextPage");
  const pageNumbersNode = document.getElementById("ledgerPageNumbers");

  if (totalCountNode) {
    totalCountNode.textContent = `共 ${formatNumber(ledgerPagination.total)} 条`;
  }

  if (pageInfoNode) {
    pageInfoNode.textContent = `${ledgerPagination.page} / ${totalPages}`;
  }

  if (prevPageButton) {
    prevPageButton.disabled = ledgerPagination.page <= 1;
  }

  if (nextPageButton) {
    nextPageButton.disabled = ledgerPagination.page >= totalPages;
  }

  if (pageNumbersNode) {
    const pageList = buildPageNumberList(ledgerPagination.page, totalPages);
    pageNumbersNode.innerHTML = pageList
      .map((item) => {
        if (item === "...") {
          return '<span class="record-page-ellipsis">...</span>';
        }

        const activeClass = item === ledgerPagination.page ? " is-active" : "";
        return `<button type="button" class="record-page-number${activeClass}" data-page="${item}">${item}</button>`;
      })
      .join("");
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatWorkflowName(workflowCode) {
  return window.ClientPortalWorkflowLabels?.getName(workflowCode) || workflowCode || "-";
}

function formatLedgerRemark(row) {
  const workflowName = row.workflow_name || formatWorkflowName(row.workflow_code);
  const points = Math.abs(Number(row.change_points ?? 0));

  if (row.ledger_type === "freeze") {
    return `${workflowName} 预冻结 ${formatNumber(points)} 积分`;
  }
  if (row.ledger_type === "charge") {
    return `${workflowName} 正式扣费 ${formatNumber(points)} 积分`;
  }
  if (row.ledger_type === "rollback") {
    return `${workflowName} 回滚 ${formatNumber(points)} 积分`;
  }
  return row.remark || "-";
}

function buildLedgerRowsFromRuns(runs = []) {
  const rows = [];

  runs.forEach((run) => {
    const runId = String(run.run_id || "");
    const workflowCode = String(run.workflow_code || "-");
    const workflowName = formatWorkflowName(workflowCode);
    const estimatedFrozenPoints = Number(run.estimated_frozen_points ?? 0);
    const finalChargePoints = Number(run.final_charge_points ?? 0);
    const refundPoints = Number(run.refund_points ?? 0);

    if (estimatedFrozenPoints > 0) {
      rows.push({
        ledger_no: `${runId}-freeze`,
        ledger_type: "freeze",
        change_points: -estimatedFrozenPoints,
        workflow_code: workflowCode,
        workflow_name: workflowName,
        run_id: runId,
        remark: `${workflowCode} 预冻结 ${estimatedFrozenPoints} 积分`,
        created_at: run.started_at || run.created_at || null,
      });
    }

    if (String(run.billing_status || "") === "charged" && finalChargePoints > 0) {
      rows.push({
        ledger_no: `${runId}-charge`,
        ledger_type: "charge",
        change_points: -finalChargePoints,
        workflow_code: workflowCode,
        workflow_name: workflowName,
        run_id: runId,
        remark: `${workflowCode} 正式扣费 ${finalChargePoints} 积分`,
        created_at: run.finished_at || run.created_at || null,
      });
    }

    if (refundPoints > 0) {
      rows.push({
        ledger_no: `${runId}-rollback`,
        ledger_type: "rollback",
        change_points: refundPoints,
        workflow_code: workflowCode,
        workflow_name: workflowName,
        run_id: runId,
        remark: `${workflowCode} 回滚 ${refundPoints} 积分`,
        created_at: run.finished_at || run.created_at || null,
      });
    }
  });

  rows.sort((left, right) => {
    const leftTime = normalizeTimestamp(left.created_at) ?? 0;
    const rightTime = normalizeTimestamp(right.created_at) ?? 0;
    return rightTime - leftTime;
  });

  return rows;
}

function applyLedgerFilters(rows = []) {
  const startTimestamp = normalizeTimestamp(ledgerQuery.startTime);
  const endTimestamp = normalizeTimestamp(ledgerQuery.endTime);
  const keyword = String(ledgerQuery.keyword || "").trim().toLowerCase();

  return rows.filter((row) => {
    if (ledgerQuery.ledgerType !== "all" && row.ledger_type !== ledgerQuery.ledgerType) {
      return false;
    }

    const rowTimestamp = normalizeTimestamp(row.created_at);
    if (startTimestamp !== null && (rowTimestamp === null || rowTimestamp < startTimestamp)) {
      return false;
    }
    if (endTimestamp !== null && (rowTimestamp === null || rowTimestamp > endTimestamp)) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    const searchable = [
      row.ledger_no,
      row.run_id,
      row.workflow_code,
      row.workflow_name,
      row.remark,
      ledgerTypeTextMap[row.ledger_type] ?? row.ledger_type,
    ]
      .join(" ")
      .toLowerCase();

    return searchable.includes(keyword);
  });
}

function renderLedgerRows(rows = []) {
  const ledgerBody = document.getElementById("ledgerBody");

  if (ledgerBody) {
    ledgerBody.innerHTML = rows.length
      ? rows
          .map((row) => {
            const changeClass = row.change_points >= 0 ? "positive" : "negative";
            const changePrefix = row.change_points >= 0 ? "+" : "";

            return `
              <tr>
                <td>${escapeHtml(row.ledger_no)}</td>
                <td>${escapeHtml(ledgerTypeTextMap[row.ledger_type] ?? row.ledger_type)}</td>
                <td><strong class="ledger-change ${changeClass}">${changePrefix}${formatNumber(row.change_points)}</strong></td>
                <td>${escapeHtml(row.workflow_name || formatWorkflowName(row.workflow_code))}</td>
                <td>${escapeHtml(row.run_id || "-")}</td>
                <td>${escapeHtml(formatLedgerRemark(row))}</td>
                <td>${escapeHtml(formatDateTime(row.created_at))}</td>
              </tr>
            `;
          })
          .join("")
      : '<tr><td colspan="7">暂无符合条件的积分流水</td></tr>';
  }
}

async function fetchAllRunsByTimeRange() {
  const pageSize = 100;
  let page = 1;
  let totalPages = 1;
  const allRuns = [];

  while (page <= totalPages) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    if (ledgerQuery.startTime) {
      params.set("start_time", ledgerQuery.startTime);
    }
    if (ledgerQuery.endTime) {
      params.set("end_time", ledgerQuery.endTime);
    }

    const result = await requestJson(`/api/v1/workflow-runs/query?${params.toString()}`);
    const rows = Array.isArray(result?.items) ? result.items : [];
    allRuns.push(...rows);

    const total = Number(result?.total ?? 0);
    totalPages = Math.max(1, Math.ceil(total / pageSize));
    page += 1;
  }

  return allRuns;
}

async function refreshLedgerList() {
  const runs = await fetchAllRunsByTimeRange();
  const ledgerRows = buildLedgerRowsFromRuns(runs);
  const filteredRows = applyLedgerFilters(ledgerRows);

  ledgerPagination.total = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(ledgerPagination.total / ledgerPagination.pageSize));
  ledgerPagination.page = Math.min(Math.max(1, ledgerPagination.page), totalPages);

  const startIndex = (ledgerPagination.page - 1) * ledgerPagination.pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + ledgerPagination.pageSize);
  renderLedgerRows(pageRows);
  renderPaginationUi();
}

function attachLedgerControls() {
  const startTimeInput = document.getElementById("ledgerStartTime");
  const endTimeInput = document.getElementById("ledgerEndTime");
  const typeSelect = document.getElementById("ledgerType");
  const keywordInput = document.getElementById("ledgerKeyword");
  const searchButton = document.getElementById("ledgerSearchButton");
  const resetButton = document.getElementById("ledgerResetButton");
  const pageSizeSelect = document.getElementById("ledgerPageSize");
  const prevPageButton = document.getElementById("ledgerPrevPage");
  const nextPageButton = document.getElementById("ledgerNextPage");
  const pageNumbersNode = document.getElementById("ledgerPageNumbers");

  if (searchButton) {
    searchButton.addEventListener("click", async () => {
      ledgerQuery.startTime = startTimeInput?.value || "";
      ledgerQuery.endTime = endTimeInput?.value || "";
      ledgerQuery.ledgerType = typeSelect?.value || "all";
      ledgerQuery.keyword = (keywordInput?.value || "").trim();
      ledgerPagination.page = 1;
      await refreshLedgerList();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", async () => {
      if (startTimeInput) startTimeInput.value = "";
      if (endTimeInput) endTimeInput.value = "";
      if (typeSelect) typeSelect.value = "all";
      if (keywordInput) keywordInput.value = "";

      ledgerQuery.startTime = "";
      ledgerQuery.endTime = "";
      ledgerQuery.ledgerType = "all";
      ledgerQuery.keyword = "";
      ledgerPagination.page = 1;
      await refreshLedgerList();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.value = String(ledgerPagination.pageSize);
    pageSizeSelect.addEventListener("change", async (event) => {
      ledgerPagination.pageSize = Number(event.target.value) || 20;
      ledgerPagination.page = 1;
      await refreshLedgerList();
    });
  }

  if (prevPageButton) {
    prevPageButton.addEventListener("click", async () => {
      if (ledgerPagination.page <= 1) {
        return;
      }

      ledgerPagination.page -= 1;
      await refreshLedgerList();
    });
  }

  if (nextPageButton) {
    nextPageButton.addEventListener("click", async () => {
      const totalPages = Math.max(1, Math.ceil(ledgerPagination.total / ledgerPagination.pageSize));
      if (ledgerPagination.page >= totalPages) {
        return;
      }

      ledgerPagination.page += 1;
      await refreshLedgerList();
    });
  }

  if (pageNumbersNode) {
    pageNumbersNode.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-page]");
      if (!button) {
        return;
      }

      const targetPage = Number(button.dataset.page);
      if (!Number.isFinite(targetPage) || targetPage === ledgerPagination.page) {
        return;
      }

      ledgerPagination.page = targetPage;
      await refreshLedgerList();
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
    refreshLedgerList(),
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
      console.error("refresh ledgers failed", error);
    }
  }, 10000);
}

async function bootstrap() {
  if (!getToken()) {
    redirectToLogin();
    return;
  }

  syncAccountView(fallbackPointAccount);
  renderLedgerRows([]);
  renderPaginationUi();
  attachLedgerControls();
  attachLogoutButton();

  try {
    await refreshData();
    startAutoRefresh();
  } catch (error) {
    if (error.message === "登录已过期，请重新登录" || error.message === "请先登录") {
      return;
    }
    console.error(error);
    alert(`积分流水加载失败: ${error.message}`);
  }
}

bootstrap();
