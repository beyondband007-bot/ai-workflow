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
let latestWorkflowRuns = [];
const recordQuery = {
  startTime: "",
  endTime: "",
  status: "all",
  orderNo: "",
};
const recordPagination = {
  page: 1,
  pageSize: 20,
};
const allowedSections = new Set(["overview", "workflows", "records", "ledger", "rules"]);
let currentSection = "overview";
let refreshTimer = null;

function resolveInitialSection() {
  const params = new URLSearchParams(window.location.search);
  const section = params.get("section");
  return allowedSections.has(section) ? section : "overview";
}

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

function resolveRecordTime(record) {
  return record.finished_at || record.started_at || record.created_at || null;
}

function toTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function getRecordOrderNo(record) {
  return String(
    record.order_no ||
      record.order_id ||
      record.client_request_id ||
      record.run_id ||
      "",
  );
}

function applyRecordFilters(workflowRuns) {
  const startTimestamp = toTimestamp(recordQuery.startTime);
  const endTimestamp = toTimestamp(recordQuery.endTime);
  const keyword = String(recordQuery.orderNo || "").trim().toLowerCase();

  return workflowRuns.filter((record) => {
    if (recordQuery.status !== "all" && record.status !== recordQuery.status) {
      return false;
    }

    const recordTimestamp = toTimestamp(resolveRecordTime(record));
    if (startTimestamp !== null && (recordTimestamp === null || recordTimestamp < startTimestamp)) {
      return false;
    }
    if (endTimestamp !== null && (recordTimestamp === null || recordTimestamp > endTimestamp)) {
      return false;
    }

    if (!keyword) {
      return true;
    }

    return getRecordOrderNo(record).toLowerCase().includes(keyword);
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

function renderRecords(workflowRuns = latestWorkflowRuns) {
  const filteredRows = applyRecordFilters(workflowRuns);
  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / recordPagination.pageSize));
  recordPagination.page = Math.min(Math.max(1, recordPagination.page), totalPages);

  const startIndex = (recordPagination.page - 1) * recordPagination.pageSize;
  const pageRows = filteredRows.slice(startIndex, startIndex + recordPagination.pageSize);

  const recordsBody = document.getElementById("recordsBody");
  const mobileRecords = document.getElementById("mobileRecords");
  const totalCountNode = document.getElementById("recordTotalCount");
  const pageInfoNode = document.getElementById("recordPageInfo");
  const prevPageButton = document.getElementById("recordPrevPage");
  const nextPageButton = document.getElementById("recordNextPage");

  if (recordsBody) {
    recordsBody.innerHTML = pageRows.length
      ? pageRows
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
    mobileRecords.innerHTML = pageRows.length
      ? pageRows
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

  if (totalCountNode) {
    totalCountNode.textContent = `共 ${formatNumber(totalCount)} 条`;
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

function setActiveSection(sectionKey, options = {}) {
  currentSection = sectionKey;
  const blocks = document.querySelectorAll("[data-section-block]");
  const navItems = document.querySelectorAll(".side-nav .nav-item");

  blocks.forEach((block) => {
    const blockKey = block.getAttribute("data-section-block");
    const isVisible =
      sectionKey === "overview"
        ? blockKey === "overview" || blockKey === "workflows"
        : sectionKey === "rules"
          ? blockKey === "ledger"
          : blockKey === sectionKey;

    block.classList.toggle("is-hidden", !isVisible);
  });

  navItems.forEach((item) => {
    item.classList.toggle("is-active", item.dataset.section === sectionKey);
  });

  if (options.scroll !== false) {
    const anchorId = sectionKey === "rules" ? "rules" : sectionKey;
    const target = document.getElementById(anchorId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function attachSidebarNavigation() {
  const navRoot = document.querySelector(".side-nav");
  if (!navRoot) {
    return;
  }

  navRoot.addEventListener("click", (event) => {
    const navItem = event.target.closest(".nav-item[data-section]");
    if (!navItem) {
      return;
    }

    event.preventDefault();
    setActiveSection(navItem.dataset.section);
  });
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
  const openRecordsButton = document.querySelector(".mobile-quick-entry .secondary-button");

  if (openRecordsButton) {
    openRecordsButton.addEventListener("click", () => {
      setActiveSection("records");
    });
  }

  if (searchButton) {
    searchButton.addEventListener("click", () => {
      recordQuery.startTime = startTimeInput?.value || "";
      recordQuery.endTime = endTimeInput?.value || "";
      recordQuery.status = statusSelect?.value || "all";
      recordQuery.orderNo = orderNoInput?.value || "";
      recordPagination.page = 1;
      renderRecords();
    });
  }

  if (resetButton) {
    resetButton.addEventListener("click", () => {
      if (startTimeInput) startTimeInput.value = "";
      if (endTimeInput) endTimeInput.value = "";
      if (statusSelect) statusSelect.value = "all";
      if (orderNoInput) orderNoInput.value = "";

      recordQuery.startTime = "";
      recordQuery.endTime = "";
      recordQuery.status = "all";
      recordQuery.orderNo = "";
      recordPagination.page = 1;
      renderRecords();
    });
  }

  if (pageSizeSelect) {
    pageSizeSelect.value = String(recordPagination.pageSize);
    pageSizeSelect.addEventListener("change", (event) => {
      recordPagination.pageSize = Number(event.target.value) || 20;
      recordPagination.page = 1;
      renderRecords();
    });
  }

  if (prevPageButton) {
    prevPageButton.addEventListener("click", () => {
      if (recordPagination.page <= 1) {
        return;
      }
      recordPagination.page -= 1;
      renderRecords();
    });
  }

  if (nextPageButton) {
    nextPageButton.addEventListener("click", () => {
      recordPagination.page += 1;
      renderRecords();
    });
  }
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
  const logoutButton = document.getElementById("logoutButton");
  if (!logoutButton) {
    return;
  }

  logoutButton.addEventListener("click", logout);
}

async function refreshDashboardData() {
  const [pointAccount, workflowRuns] = await Promise.all([
    requestJson("/api/v1/point-accounts/me"),
    requestJson("/api/v1/workflow-runs"),
  ]);

  latestWorkflowRuns = workflowRuns;
  syncAccountView(pointAccount);
  renderRecords(workflowRuns);
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
  currentSection = resolveInitialSection();
  // renderApiContracts();
  syncAccountView(fallbackPointAccount);
  renderRecords([]);
  renderLedgers([]);
  attachLogoutButton();
  attachSidebarNavigation();
  attachRecordControls();
  setActiveSection(currentSection, { scroll: false });

  try {
    const [pointAccount, workflows, workflowRuns] = await Promise.all([
      requestJson("/api/v1/point-accounts/me"),
      requestJson("/api/v1/workflows"),
      requestJson("/api/v1/workflow-runs"),
    ]);

    latestWorkflowRuns = workflowRuns;
    syncAccountView(pointAccount);
    renderWorkflows(workflows);
    renderRecords(workflowRuns);
    renderLedgers(workflowRuns);
    renderConnectionState(`账号 ${pointAccount.username || pointAccount.user_id} 已连接中台`, false);
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
