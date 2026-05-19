const RECHARGE_PLANS = [100, 200, 300, 500, 1000, 2000, 3000];
const POINTS_PER_YUAN = 100;
const RECHARGE_RECORDS_KEY = "client_portal_recharge_records";
const RECHARGE_TOKEN_KEY = "auth_demo_token";
const ALIPAY_POLL_INTERVAL_MS = 5000;
const ORDER_CODE_EXPIRES_MS = 3 * 60 * 1000;
const TOAST_VISIBLE_MS = 2000;
let copyToastTimer = 0;
let activeAlipayOrder = null;
let alipayPollTimer = 0;
let orderCountdownTimer = 0;
let alipaySyncPromise = null;

const emptyRechargeAccount = {
  total_paid_recharge_amount: 0,
  total_paid_recharge_points: 0,
  total_recharged_points: 0,
  total_consumed_points: 0,
  month_spent_points: 0,
  today_spent_points: 0,
};

function rechargeFormatNumber(value, options) {
  return Number(value ?? 0).toLocaleString("zh-CN", options);
}

function rechargeSetText(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function resolveRechargeApiBase() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:3002";
  }

  if (port === "3003") {
    return `${protocol}//${hostname}:3002`;
  }

  return "";
}

function resolveRechargeAuthEntryUrl() {
  const { protocol, hostname, port } = window.location;

  if (protocol === "file:") {
    return "http://127.0.0.1:8080/auth/?mode=login";
  }

  if (port === "3003") {
    return `${protocol}//${hostname}:8000/auth/?mode=login`;
  }

  return `${window.location.origin}/auth/?mode=login`;
}

function clearRechargeAuthState() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.clearAuthState();
    return;
  }

  window.localStorage.removeItem(RECHARGE_TOKEN_KEY);
  window.localStorage.removeItem("client_portal_profile");
}

function redirectRechargeLogin() {
  if (window.ClientPortalAuth) {
    window.ClientPortalAuth.redirectToLogin();
    return;
  }

  clearRechargeAuthState();
  window.location.replace(resolveRechargeAuthEntryUrl());
}

async function rechargeApiRequest(path, options = {}) {
  const isFormDataBody = typeof FormData !== "undefined" && options.body instanceof FormData;
  const requestOptions = {
    ...options,
    headers: {
      ...(options.body && !isFormDataBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  };
  const response = window.ClientPortalAuth
    ? await window.ClientPortalAuth.authFetch(path, requestOptions)
    : await fetch(`${resolveRechargeApiBase()}${path}`, {
        ...requestOptions,
        headers: {
          ...requestOptions.headers,
          ...(getRechargeToken() ? { Authorization: `Bearer ${getRechargeToken()}` } : {}),
        },
      });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (response.status === 401) {
      redirectRechargeLogin();
      throw new Error("登录已过期，请重新登录");
    }
    throw new Error(data?.message || data?.error || `请求失败：${response.status}`);
  }
  return data;
}

function getRechargeToken() {
  if (window.ClientPortalAuth) {
    return window.ClientPortalAuth.readToken();
  }
  return "";
}

async function fetchRechargeAccount() {
  try {
    const response = window.ClientPortalAuth
      ? await window.ClientPortalAuth.authFetch("/api/v1/point-accounts/me")
      : await fetch(`${resolveRechargeApiBase()}/api/v1/point-accounts/me`, {
          headers: getRechargeToken() ? { Authorization: `Bearer ${getRechargeToken()}` } : {},
        });
    if (!response.ok) {
      if (response.status === 401) {
        redirectRechargeLogin();
        throw new Error("登录已过期，请重新登录");
      }
      throw new Error(`Request failed: ${response.status}`);
    }
    return {
      ...emptyRechargeAccount,
      ...(await response.json()),
    };
  } catch (error) {
    console.warn("failed to fetch recharge account", error);
    if (error.message === "登录已过期，请重新登录") {
      throw error;
    }
    return emptyRechargeAccount;
  }
}

function normalizeRechargeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.floor(amount);
}

function getRechargePoints(amount) {
  return normalizeRechargeAmount(amount) * POINTS_PER_YUAN;
}

function validateRechargeAmount(amount) {
  if (!Number.isFinite(amount) || amount < 100) {
    return "充值金额不能低于 100 元";
  }
  if (amount % 100 !== 0) {
    return "充值金额需为 100 元的整数倍";
  }
  return "";
}

function escapeRechargeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRechargeRecordTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

function getRechargeProviderLabel(provider, fallback) {
  if (provider === "wechat") {
    return "微信支付";
  }
  if (provider === "alipay") {
    return "支付宝";
  }
  if (provider === "offline_transfer") {
    return "线下转账";
  }
  return fallback || "-";
}

function getRechargeStatusLabel(status, fallback) {
  const labels = {
    CREATED: "已创建",
    QR_READY: "待支付",
    WAITING_PAYMENT: "待支付",
    SCANNED: "已扫码",
    USERPAYING: "已扫码",
    PAID: "已支付",
    EXPIRED: "订单超时",
    CLOSED: "已关闭",
    CANCELED: "已取消",
    REFUNDED: "已退款",
    AMOUNT_MISMATCH: "金额异常",
    PENDING_REVIEW: "待审核",
    REVIEWING: "审核中",
    REJECTED: "审核失败",
  };
  return labels[status] || fallback || status || "-";
}

function getRechargeStatusClass(status) {
  if (status === "PAID") {
    return "status-success";
  }
  if (["REJECTED", "AMOUNT_MISMATCH", "CLOSED", "CANCELED", "EXPIRED"].includes(status)) {
    return "status-error";
  }
  return "status-running";
}

async function fetchRechargeRecords() {
  try {
    return await rechargeApiRequest("/api/v1/recharge-orders");
  } catch (error) {
    console.warn("failed to fetch recharge records", error);
    return getStoredRechargeRecords();
  }
}

function getStoredRechargeRecords() {
  try {
    const raw = window.localStorage.getItem(RECHARGE_RECORDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.warn("failed to read recharge records", error);
    return [];
  }
}

function setStoredRechargeRecords(records) {
  try {
    window.localStorage.setItem(RECHARGE_RECORDS_KEY, JSON.stringify(records.slice(0, 20)));
  } catch (error) {
    console.warn("failed to write recharge records", error);
  }
}

function addRechargeRecord(record) {
  const records = getStoredRechargeRecords();
  records.unshift(record);
  setStoredRechargeRecords(records);
  renderRechargeRecords();
}

function showRechargeError(id, message) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }
  element.hidden = !message;
  element.textContent = message || "";
}

async function renderRechargeSummary() {
  const account = await fetchRechargeAccount();
  const totalRechargeAmount = Number(
    account.total_paid_recharge_amount ?? Number(account.total_paid_recharge_points ?? 0) / POINTS_PER_YUAN,
  );
  rechargeSetText("totalRechargeAmount", rechargeFormatNumber(totalRechargeAmount, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }));
  rechargeSetText("totalConsumedPoints", rechargeFormatNumber(account.total_consumed_points));
  rechargeSetText("monthSpentPoints", rechargeFormatNumber(account.month_spent_points ?? account.current_month_spent_points ?? 0));
  rechargeSetText("todaySpentPoints", rechargeFormatNumber(account.today_spent_points));
}

function renderAmountGrid(gridId, inputId, previewId) {
  const grid = document.getElementById(gridId);
  const input = document.getElementById(inputId);
  if (!grid || !input) {
    return;
  }

  grid.innerHTML = [
    ...RECHARGE_PLANS.map((amount) => `
      <button class="amount-option${amount === Number(input.value) ? " is-active" : ""}" type="button" data-amount="${amount}">
        <strong>￥${rechargeFormatNumber(amount)}</strong>
        <span>${rechargeFormatNumber(getRechargePoints(amount))} 积分</span>
      </button>
    `),
    `<button class="amount-option custom-option" type="button" data-custom="true">
      <strong>自定义</strong>
      <span>100 的整数倍</span>
    </button>`,
  ].join("");

  const syncActive = () => {
    const amount = normalizeRechargeAmount(input.value);
    grid.querySelectorAll(".amount-option").forEach((button) => {
      button.classList.toggle("is-active", Number(button.dataset.amount) === amount);
    });
    if (previewId) {
      rechargeSetText(previewId, `${rechargeFormatNumber(getRechargePoints(amount))} 积分`);
    }
  };

  grid.addEventListener("click", (event) => {
    const button = event.target.closest(".amount-option");
    if (!button) {
      return;
    }
    if (button.dataset.custom) {
      input.focus();
      input.select();
      return;
    }
    input.value = button.dataset.amount;
    syncActive();
  });

  input.addEventListener("input", syncActive);
  syncActive();
}

async function renderRechargeRecords() {
  const body = document.getElementById("rechargeRecordsBody");
  if (!body) {
    return;
  }
  const records = await fetchRechargeRecords();
  body.innerHTML = records.length
    ? records.map((record) => `
      <tr>
        <td>${escapeRechargeHtml(record.outTradeNo || record.orderNo)}</td>
        <td>${escapeRechargeHtml(getRechargeProviderLabel(record.provider, record.method))}</td>
        <td>￥${rechargeFormatNumber(record.totalAmount ?? record.amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>${rechargeFormatNumber(record.points)}</td>
        <td><span class="status-pill ${getRechargeStatusClass(record.status)}">${escapeRechargeHtml(getRechargeStatusLabel(record.status, record.status))}</span></td>
        <td>${escapeRechargeHtml(formatRechargeRecordTime(record.createdAt))}</td>
        <td class="recharge-record-note">${escapeRechargeHtml(record.reviewNote || record.statusMessage || "-")}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="7">暂无充值记录</td></tr>';
}

function closeAlipayModal() {
  const modal = document.getElementById("alipayModal");
  modal?.classList.remove("is-open");
  modal?.setAttribute("aria-hidden", "true");
  stopOrderCountdown();
}

function stopAlipayPolling() {
  if (alipayPollTimer) {
    window.clearInterval(alipayPollTimer);
    alipayPollTimer = 0;
  }
}

function stopOrderCountdown() {
  if (orderCountdownTimer) {
    window.clearInterval(orderCountdownTimer);
    orderCountdownTimer = 0;
  }
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function updateOrderCountdown() {
  if (!activeAlipayOrder?.expiresAt) {
    return;
  }
  const remaining = activeAlipayOrder.expiresAt - Date.now();
  rechargeSetText("alipayCountdown", formatCountdown(remaining));
  if (remaining <= 0) {
    stopAlipayPolling();
    closeAlipayModal();
    activeAlipayOrder = null;
    showPaymentStatusModal({
      title: "订单码已超时",
      label: "订单提醒",
      message: "订单码有效期已结束，请重新创建充值订单",
      tone: "warning",
    });
  }
}

function startOrderCountdown() {
  stopOrderCountdown();
  updateOrderCountdown();
  orderCountdownTimer = window.setInterval(updateOrderCountdown, 1000);
}

function setQrScannedState(scanned) {
  document.getElementById("alipayQrMask")?.setAttribute("aria-hidden", String(!scanned));
  document.querySelector(".alipay-qr-frame")?.classList.toggle("is-scanned", scanned);
}

function openAlipayModal(order) {
  stopAlipayPolling();
  activeAlipayOrder = {
    ...order,
    completed: false,
    expiresAt: Date.now() + ORDER_CODE_EXPIRES_MS,
  };
  const isWechatPay = order.provider === "wechat";
  rechargeSetText("alipayModalEyebrow", isWechatPay ? "Wechat Pay Order Code" : "Alipay Order Code");
  rechargeSetText("alipayModalTitle", isWechatPay ? "微信支付订单码" : "支付宝订单码");
  rechargeSetText("alipayModalAmount", `￥${rechargeFormatNumber(order.amount)}`);
  rechargeSetText("alipayModalPoints", `${rechargeFormatNumber(order.points)} 积分`);
  rechargeSetText("alipayModalOrderNo", order.orderNo);
  document
    .getElementById("alipayModalClose")
    ?.setAttribute("aria-label", isWechatPay ? "关闭微信支付订单码" : "关闭支付宝订单码");
  const qrImage = document.getElementById("alipayQrImage");
  if (qrImage) {
    qrImage.src = order.qrCodeDataUrl || "";
    qrImage.alt = isWechatPay ? "微信支付订单码" : "支付宝订单码";
  }
  setQrScannedState(false);
  rechargeSetText("alipayCountdown", "03:00");

  const modal = document.getElementById("alipayModal");
  modal?.classList.add("is-open");
  modal?.setAttribute("aria-hidden", "false");
  startOrderCountdown();
  startAlipayPolling();
}

function startAlipayPolling() {
  stopAlipayPolling();
  alipayPollTimer = window.setInterval(() => {
    syncActiveAlipayOrder({ source: "poll" });
  }, ALIPAY_POLL_INTERVAL_MS);
}

function getAlipayCloseMessage(order) {
  if (!order) {
    return "订单码已关闭";
  }
  if (order.status === "PAID") {
    return "订单支付成功，积分已到账";
  }
  if (order.status === "CLOSED") {
    return order.statusMessage || "支付失败：交易已关闭";
  }
  if (order.status === "EXPIRED") {
    return order.statusMessage || "订单超时";
  }
  if (order.status === "CANCELED") {
    return order.statusMessage || "已取消订单";
  }
  if (order.status === "AMOUNT_MISMATCH") {
    return order.statusMessage || "支付金额异常，已暂停入账";
  }
  return "订单码已关闭，暂未检测到支付";
}

function closePaymentStatusModal() {
  const modal = document.getElementById("paymentStatusModal");
  modal?.classList.remove("is-open", "is-success", "is-warning", "is-error");
  modal?.setAttribute("aria-hidden", "true");
}

function showPaymentStatusModal({ title = "订单状态", label = "订单提醒", message = "", tone = "success" } = {}) {
  const modal = document.getElementById("paymentStatusModal");
  if (!modal) {
    showCopyToast(message || title);
    return;
  }

  modal.classList.remove("is-success", "is-warning", "is-error");
  modal.classList.add(`is-${tone}`);
  rechargeSetText("paymentStatusTitle", title);
  rechargeSetText("paymentStatusLabel", label);
  rechargeSetText("paymentStatusMessage", message || title);
  rechargeSetText("paymentStatusIcon", tone === "success" ? "✓" : "!");
  modal.classList.add("is-open");
  modal.setAttribute("aria-hidden", "false");
}

function openRechargeRecordsTab() {
  const recordsTab = document.querySelector('.recharge-tab[data-tab="records"]');
  recordsTab?.click();
  closePaymentStatusModal();
}

function addPaidRechargeRecord(order) {
  const records = getStoredRechargeRecords();
  if (records.some((record) => record.orderNo === order.outTradeNo)) {
    return;
  }
  addRechargeRecord({
    orderNo: order.outTradeNo,
    method: order.provider === "wechat" ? "微信支付" : "支付宝",
    amount: Number(order.totalAmount),
    points: Number(order.points),
    status: "已支付",
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
  });
}

async function handlePaidAlipayOrder(order) {
  if (!activeAlipayOrder || activeAlipayOrder.completed) {
    return;
  }
  activeAlipayOrder.completed = true;
  stopAlipayPolling();
  stopOrderCountdown();
  await renderRechargeRecords();
  await renderRechargeSummary();
  closeAlipayModal();
  activeAlipayOrder = null;
  showPaymentStatusModal({
    title: "充值成功",
    label: "本次成功充值",
    message: `${rechargeFormatNumber(order.points)} 积分`,
    tone: "success",
  });
}

async function syncActiveAlipayOrder({ source = "poll" } = {}) {
  if (!activeAlipayOrder) {
    return null;
  }

  if (alipaySyncPromise) {
    return alipaySyncPromise;
  }

  alipaySyncPromise = (async () => {
    const order = await rechargeApiRequest(`/api/v1/recharge-orders/${activeAlipayOrder.orderNo}/sync`, {
      headers: {
        "X-Order-Token": activeAlipayOrder.orderToken,
      },
    });
    if (order.status === "PAID") {
      await handlePaidAlipayOrder(order);
    } else {
      if (["SCANNED", "USERPAYING"].includes(order.status)) {
        setQrScannedState(true);
      }
      if (["CLOSED", "EXPIRED", "CANCELED", "AMOUNT_MISMATCH", "REFUNDED"].includes(order.status)) {
        stopAlipayPolling();
        stopOrderCountdown();
        closeAlipayModal();
        activeAlipayOrder = null;
        showPaymentStatusModal({
          title: "订单已关闭",
          label: "订单提醒",
          message: getAlipayCloseMessage(order),
          tone: "warning",
        });
      }
    }
    return order;
  })();

  try {
    return await alipaySyncPromise;
  } catch (error) {
    console.warn("failed to sync alipay order", error);
    if (source !== "poll") {
      showPaymentStatusModal({
        title: "支付确认失败",
        label: "订单提醒",
        message: error.message || "支付确认失败",
        tone: "error",
      });
    }
    return null;
  } finally {
    alipaySyncPromise = null;
  }
}

async function requestCloseAlipayModal() {
  if (!activeAlipayOrder) {
    closeAlipayModal();
    return;
  }

  stopAlipayPolling();
  const order = await syncActiveAlipayOrder({ source: "close" });
  if (!activeAlipayOrder || order?.status === "PAID") {
    return;
  }
  closeAlipayModal();
  activeAlipayOrder = null;
  showPaymentStatusModal({
    title: "订单已关闭",
    label: "订单提醒",
    message: getAlipayCloseMessage(order),
    tone: "warning",
  });
}

function bindRechargeTabs() {
  const tabs = Array.from(document.querySelectorAll(".recharge-tab"));
  const panels = {
    online: document.getElementById("onlinePanel"),
    offline: document.getElementById("offlinePanel"),
    records: document.getElementById("recordsPanel"),
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-selected", String(isActive));
      });
      Object.entries(panels).forEach(([key, panel]) => {
        if (!panel) {
          return;
        }
        const isActive = key === target;
        panel.classList.toggle("is-active", isActive);
        panel.hidden = !isActive;
      });
    });
  });
}

function bindRechargeForms() {
  const onlineForm = document.getElementById("onlineRechargeForm");
  const offlineForm = document.getElementById("offlineRechargeForm");
  const onlineAmountInput = document.getElementById("onlineAmountInput");
  const offlineAmountInput = document.getElementById("offlineAmountInput");
  const voucherInput = document.getElementById("offlineVoucherInput");
  const voucherName = document.getElementById("offlineVoucherName");

  onlineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = normalizeRechargeAmount(onlineAmountInput?.value);
    const error = validateRechargeAmount(amount);
    if (error) {
      showRechargeError("onlineRechargeError", error);
      return;
    }
    showRechargeError("onlineRechargeError", "");
    const payment = document.querySelector('input[name="onlinePayment"]:checked')?.value;
    const provider = payment === "wechat" ? "wechat" : "alipay";

    const submitButton = onlineForm.querySelector(".recharge-submit");
    submitButton.disabled = true;
    submitButton.textContent = "创建订单中...";

    try {
      const created = await rechargeApiRequest("/api/v1/recharge-orders", {
        method: "POST",
        body: JSON.stringify({
          amount,
          provider,
        }),
      });
      const qrResult = await rechargeApiRequest(`/api/v1/recharge-orders/${created.order.outTradeNo}/qrcode`, {
        headers: {
          "X-Order-Token": created.orderToken,
        },
      });
      openAlipayModal({
        orderNo: created.order.outTradeNo,
        orderToken: created.orderToken,
        amount: Number(created.order.totalAmount),
        points: Number(created.order.points),
        provider: created.order.provider || provider,
        qrCodeDataUrl: qrResult.qrCodeDataUrl,
      });
    } catch (error) {
      console.warn("failed to create alipay recharge order", error);
      showRechargeError("onlineRechargeError", error.message || "创建支付宝订单失败");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "立即充值";
    }
  });

  offlineForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = normalizeRechargeAmount(offlineAmountInput?.value);
    const amountError = validateRechargeAmount(amount);
    if (amountError) {
      showRechargeError("offlineRechargeError", amountError);
      return;
    }
    if (!voucherInput?.files?.length) {
      showRechargeError("offlineRechargeError", "请先上传支付凭证");
      return;
    }
    showRechargeError("offlineRechargeError", "");

    const submitButton = offlineForm.querySelector(".recharge-submit");
    submitButton.disabled = true;
    submitButton.textContent = "提交中...";

    try {
      const formData = new FormData();
      formData.append("amount", String(amount));
      formData.append("voucher", voucherInput.files[0]);
      const result = await rechargeApiRequest("/api/v1/offline-recharge-orders", {
        method: "POST",
        body: formData,
      });
      voucherInput.value = "";
      if (voucherName) {
        voucherName.textContent = "请选择付款截图或 PDF";
      }
      await renderRechargeRecords();
      showPaymentStatusModal({
        title: "提交成功",
        label: "线下转账申请",
        message: `订单 ${result?.order?.outTradeNo || ""} 已进入审核`,
        tone: "success",
      });
    } catch (error) {
      console.warn("failed to submit offline recharge order", error);
      showRechargeError("offlineRechargeError", error.message || "提交线下充值申请失败");
      showPaymentStatusModal({
        title: "提交失败",
        label: "线下转账申请",
        message: error.message || "提交线下充值申请失败",
        tone: "error",
      });
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "提交审核";
    }
  });

  voucherInput?.addEventListener("change", () => {
    const file = voucherInput.files?.[0];
    if (voucherName) {
      voucherName.textContent = file ? file.name : "请选择付款截图或 PDF";
    }
    if (file) {
      showRechargeError("offlineRechargeError", "");
    }
  });
}

function bindAlipayModal() {
  document.getElementById("alipayModalClose")?.addEventListener("click", requestCloseAlipayModal);
  document.querySelector("[data-alipay-close]")?.addEventListener("click", requestCloseAlipayModal);
  document.getElementById("paymentStatusClose")?.addEventListener("click", closePaymentStatusModal);
  document.getElementById("paymentStatusDismiss")?.addEventListener("click", closePaymentStatusModal);
  document.querySelector("[data-payment-status-close]")?.addEventListener("click", closePaymentStatusModal);
  document.getElementById("paymentStatusRecords")?.addEventListener("click", openRechargeRecordsTab);
  window.addEventListener("beforeunload", () => {
    stopAlipayPolling();
    stopOrderCountdown();
  });
}

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, value.length);

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

async function copyRechargeText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return fallbackCopyText(value);
}

function showCopyToast(message = "已复制") {
  const toast = document.getElementById("copyToast");
  if (!toast) {
    return;
  }

  window.clearTimeout(copyToastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toast.setAttribute("aria-hidden", "false");

  copyToastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    toast.setAttribute("aria-hidden", "true");
  }, TOAST_VISIBLE_MS);
}

function bindCompanyAccountCopy() {
  document.querySelectorAll(".account-copy-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copyValue || "";
      const label = button.dataset.copyLabel || "信息";
      if (!value) {
        return;
      }

      try {
        const copied = await copyRechargeText(value);
        if (!copied) {
          throw new Error("Copy command failed");
        }
        showCopyToast("已复制");
        button.classList.add("is-copied");
        button.setAttribute("aria-label", `已复制${label}`);
        window.setTimeout(() => {
          button.classList.remove("is-copied");
          button.setAttribute("aria-label", `复制${label}`);
        }, 1200);
      } catch (error) {
        console.warn("failed to copy company account info", error);
        window.alert(`复制失败，请手动复制${label}`);
      }
    });
  });
}

async function initRechargeCenter() {
  await window.ClientPortalAuth?.ensureAuthenticated();
  renderRechargeSummary();
  renderAmountGrid("onlineAmountGrid", "onlineAmountInput", "onlinePointPreview");
  renderAmountGrid("offlineAmountGrid", "offlineAmountInput");
  renderRechargeRecords();
  bindRechargeTabs();
  bindRechargeForms();
  bindAlipayModal();
  bindCompanyAccountCopy();
}

document.addEventListener("DOMContentLoaded", initRechargeCenter);
