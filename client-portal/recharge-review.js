function reviewApiBase() {
  const { protocol, hostname, port } = window.location;
  if (protocol === "file:") {
    return "http://127.0.0.1:3002";
  }
  if (port === "3003") {
    return `${protocol}//${hostname}:3002`;
  }
  return "";
}

function reviewLoginUrl() {
  const { protocol, hostname, port } = window.location;
  if (protocol === "file:") {
    return "http://127.0.0.1:8080/auth/?mode=login";
  }
  if (port === "3003") {
    return `${protocol}//${hostname}:8000/auth/?mode=login`;
  }
  return `${window.location.origin}/auth/?mode=login`;
}

function reviewToken() {
  return window.ClientPortalAuth?.readToken?.() || "";
}

function redirectReviewLogin() {
  if (window.ClientPortalAuth?.redirectToLogin) {
    window.ClientPortalAuth.redirectToLogin();
    return;
  }
  window.location.replace(reviewLoginUrl());
}

async function reviewRequest(path, options = {}) {
  const requestOptions = {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };
  const response = window.ClientPortalAuth
    ? await window.ClientPortalAuth.authFetch(path, requestOptions)
    : await fetch(`${reviewApiBase()}${path}`, {
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          ...(reviewToken() ? { Authorization: `Bearer ${reviewToken()}` } : {}),
        },
      });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401) {
      redirectReviewLogin();
      throw new Error("登录已过期，请重新登录");
    }
    const error = new Error(data?.message || data?.error || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeReviewHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatReviewNumber(value, options) {
  return Number(value ?? 0).toLocaleString("zh-CN", options);
}

function formatReviewTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function reviewStatusLabel(status) {
  const labels = {
    PENDING_REVIEW: "待审核",
    REVIEWING: "审核中",
    PAID: "已通过",
    REJECTED: "审核失败",
  };
  return labels[status] || status || "-";
}

function reviewStatusClass(status) {
  if (status === "PAID") {
    return "status-success";
  }
  if (status === "REJECTED") {
    return "status-error";
  }
  return "status-running";
}

let reviewMessageTimer = 0;

function setReviewMessage(message) {
  const modal = document.getElementById("reviewMessage");
  const text = document.getElementById("reviewMessageText");
  if (!modal || !text) {
    return;
  }

  window.clearTimeout(reviewMessageTimer);
  if (!message) {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    text.textContent = "";
    return;
  }

  text.textContent = message;
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
  reviewMessageTimer = window.setTimeout(() => {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }, 2000);
}

function showReviewMain() {
  const main = document.getElementById("reviewMain");
  const denied = document.getElementById("reviewDeniedPage");
  if (main) {
    main.hidden = false;
  }
  if (denied) {
    denied.hidden = true;
  }
}

function showReviewDenied(message) {
  const main = document.getElementById("reviewMain");
  const denied = document.getElementById("reviewDeniedPage");
  const text = document.getElementById("reviewDeniedText");
  if (main) {
    main.hidden = true;
  }
  if (denied) {
    denied.hidden = false;
  }
  if (text) {
    text.textContent = message || "当前账号没有线下充值审核权限。";
  }
  setReviewMessage(message || "当前账号没有线下充值审核权限。");
}

async function ensureReviewAccess() {
  if (!window.ClientPortalAuth?.ensureAuthenticated) {
    redirectReviewLogin();
    return false;
  }

  try {
    await window.ClientPortalAuth.ensureAuthenticated();
    const currentUser = await reviewRequest("/me");
    if (currentUser?.role !== "admin") {
      showReviewDenied("当前账号没有线下充值审核权限。");
      return false;
    }
    showReviewMain();
    return true;
  } catch (error) {
    if (error.status === 401) {
      redirectReviewLogin();
      return false;
    }
    if (error.status === 403) {
      showReviewDenied(error.message || "当前账号没有线下充值审核权限。");
      return false;
    }
    throw error;
  }
}

function getReviewStatusFilterValue() {
  return document.getElementById("reviewStatusFilter")?.dataset.value || "pending";
}

function applyReviewTheme() {
  const savedTheme = window.localStorage.getItem("client_portal_theme") || "dark";
  document.body.dataset.theme = savedTheme === "light" ? "light" : "dark";
}

function closeReviewSelect() {
  const select = document.getElementById("reviewStatusFilter");
  const trigger = document.getElementById("reviewStatusTrigger");
  select?.classList.remove("is-open");
  trigger?.setAttribute("aria-expanded", "false");
}

function bindReviewSelect() {
  const select = document.getElementById("reviewStatusFilter");
  const trigger = document.getElementById("reviewStatusTrigger");
  const label = document.getElementById("reviewStatusLabel");
  if (!select || !trigger || !label) {
    return;
  }

  trigger.addEventListener("click", () => {
    const isOpen = select.classList.toggle("is-open");
    trigger.setAttribute("aria-expanded", String(isOpen));
  });

  select.querySelectorAll(".review-select-option").forEach((option) => {
    option.addEventListener("click", async () => {
      select.dataset.value = option.dataset.value || "pending";
      label.textContent = option.textContent || "待审核";
      select.querySelectorAll(".review-select-option").forEach((item) => {
        const isActive = item === option;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-selected", String(isActive));
      });
      closeReviewSelect();
      await loadReviewOrders();
    });
  });

  document.addEventListener("click", (event) => {
    if (!select.contains(event.target)) {
      closeReviewSelect();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeReviewSelect();
    }
  });
}

function renderReviewOrders(orders) {
  const list = document.getElementById("reviewList");
  if (!list) {
    return;
  }
  if (!orders.length) {
    list.innerHTML = '<div class="review-empty">暂无需要审核的线下充值订单</div>';
    return;
  }

  list.innerHTML = orders.map((order) => {
    const userLabel = order.user?.nickname || order.user?.username || order.user?.email || "-";
    const canReview = ["PENDING_REVIEW", "REVIEWING"].includes(order.status);
    return `
      <article class="review-order-card" data-order-no="${escapeReviewHtml(order.outTradeNo)}">
        <div class="review-order-top">
          <h3>${escapeReviewHtml(order.outTradeNo)}</h3>
          <span class="status-pill ${reviewStatusClass(order.status)}">${escapeReviewHtml(reviewStatusLabel(order.status))}</span>
        </div>
        <div class="review-order-meta">
          <div><span>用户</span><strong>${escapeReviewHtml(userLabel)}</strong></div>
          <div><span>金额</span><strong>￥${formatReviewNumber(order.totalAmount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
          <div><span>到账积分</span><strong>${formatReviewNumber(order.points)}</strong></div>
          <div><span>提交时间</span><strong>${escapeReviewHtml(formatReviewTime(order.createdAt))}</strong></div>
          <div><span>支付凭证</span><a href="${escapeReviewHtml(order.voucherFileUrl || "#")}" target="_blank" rel="noopener">查看凭证</a></div>
          <div><span>交易单号</span><strong>${escapeReviewHtml(order.transferTradeNo || "-")}</strong></div>
          <div><span>审核人</span><strong>${escapeReviewHtml(order.reviewedBy || "-")}</strong></div>
          <div><span>审核备注</span><strong>${escapeReviewHtml(order.reviewNote || order.statusMessage || "-")}</strong></div>
        </div>
        ${canReview ? `
          <form class="review-order-form">
            <input name="transferTradeNo" type="text" placeholder="审核通过交易单号" autocomplete="off" />
            <textarea name="reason" placeholder="通过备注 / 拒审原因"></textarea>
            <button class="primary-button" type="submit" data-action="approve">通过</button>
            <button class="secondary-button" type="submit" data-action="reject">拒审</button>
          </form>
        ` : ""}
      </article>
    `;
  }).join("");
}

async function loadReviewOrders() {
  const filter = getReviewStatusFilterValue();
  setReviewMessage("");
  try {
    const orders = await reviewRequest(`/api/v1/admin/offline-recharge-orders?status=${encodeURIComponent(filter)}`);
    renderReviewOrders(orders);
    setReviewMessage("");
  } catch (error) {
    console.warn("failed to load offline recharge orders", error);
    if (error.status === 403) {
      showReviewDenied(error.message || "当前账号没有线下充值审核权限。");
      return;
    }
    setReviewMessage(error.message || "加载失败");
  }
}

async function handleReviewSubmit(event) {
  const button = event.submitter;
  const form = event.target.closest(".review-order-form");
  const card = event.target.closest(".review-order-card");
  if (!button || !form || !card) {
    return;
  }
  event.preventDefault();

  const orderNo = card.dataset.orderNo;
  const action = button.dataset.action;
  const formData = new FormData(form);
  const transferTradeNo = String(formData.get("transferTradeNo") || "").trim();
  const reason = String(formData.get("reason") || "").trim();

  if (action === "approve" && !transferTradeNo) {
    setReviewMessage("审核通过必须填写交易单号");
    return;
  }
  if (action === "reject" && !reason) {
    setReviewMessage("拒审必须填写原因");
    return;
  }

  button.disabled = true;
  setReviewMessage("");
  try {
    const path = action === "approve"
      ? `/api/v1/admin/offline-recharge-orders/${encodeURIComponent(orderNo)}/approve`
      : `/api/v1/admin/offline-recharge-orders/${encodeURIComponent(orderNo)}/reject`;
    const payload = action === "approve"
      ? { transferTradeNo, note: reason }
      : { reason };
    const result = await reviewRequest(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    setReviewMessage(result.message || "已处理");
    await loadReviewOrders();
  } catch (error) {
    console.warn("failed to review offline recharge order", error);
    setReviewMessage(error.message || "处理失败");
  } finally {
    button.disabled = false;
  }
}

async function initRechargeReview() {
  applyReviewTheme();
  const hasAccess = await ensureReviewAccess();
  if (!hasAccess) {
    return;
  }
  bindReviewSelect();
  document.getElementById("reviewRefreshButton")?.addEventListener("click", loadReviewOrders);
  document.getElementById("reviewList")?.addEventListener("submit", handleReviewSubmit);
  await loadReviewOrders();
}

document.addEventListener("DOMContentLoaded", initRechargeReview);
