const RECHARGE_PLANS = [100, 200, 300, 500, 1000, 2000, 3000];
const POINTS_PER_YUAN = 100;
const RECHARGE_RECORDS_KEY = "client_portal_recharge_records";
const RECHARGE_TOKEN_KEY = "auth_demo_token";
const ALIPAY_POLL_INTERVAL_MS = 5000;
const TOAST_VISIBLE_MS = 2000;
let copyToastTimer = 0;
let activeAlipayOrder = null;
let alipayPollTimer = 0;
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
  const token = getRechargeToken();
  if (!token) {
    throw new Error("请先登录后再充值");
  }

  const response = await fetch(`${resolveRechargeApiBase()}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
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

  const urlToken = new URLSearchParams(window.location.search).get("token");
  if (urlToken) {
    window.localStorage.setItem(RECHARGE_TOKEN_KEY, urlToken);
    return urlToken;
  }
  return window.localStorage.getItem(RECHARGE_TOKEN_KEY);
}

async function fetchRechargeAccount() {
  const token = getRechargeToken();
  if (!token) {
    redirectRechargeLogin();
    throw new Error("请先登录后再查看充值中心");
  }

  try {
    const response = await fetch(`${resolveRechargeApiBase()}/api/v1/point-accounts/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
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

function renderRechargeRecords() {
  const body = document.getElementById("rechargeRecordsBody");
  if (!body) {
    return;
  }
  const records = getStoredRechargeRecords();
  body.innerHTML = records.length
    ? records.map((record) => `
      <tr>
        <td>${record.orderNo}</td>
        <td>${record.method}</td>
        <td>￥${rechargeFormatNumber(record.amount)}</td>
        <td>${rechargeFormatNumber(record.points)}</td>
        <td><span class="status-pill ${record.status === "已支付" ? "status-success" : "status-running"}">${record.status}</span></td>
        <td>${record.createdAt}</td>
      </tr>
    `).join("")
    : '<tr><td colspan="6">暂无充值记录</td></tr>';
}

function closeAlipayModal() {
  const modal = document.getElementById("alipayModal");
  modal?.classList.remove("is-open");
  modal?.setAttribute("aria-hidden", "true");
}

function stopAlipayPolling() {
  if (alipayPollTimer) {
    window.clearInterval(alipayPollTimer);
    alipayPollTimer = 0;
  }
}

function openAlipayModal(order) {
  stopAlipayPolling();
  activeAlipayOrder = {
    ...order,
    completed: false,
  };
  rechargeSetText("alipayModalAmount", `￥${rechargeFormatNumber(order.amount)}`);
  rechargeSetText("alipayModalPoints", `${rechargeFormatNumber(order.points)} 积分`);
  rechargeSetText("alipayModalOrderNo", order.orderNo);
  const qrImage = document.getElementById("alipayQrImage");
  if (qrImage) {
    qrImage.src = order.qrCodeDataUrl || "";
  }

  const modal = document.getElementById("alipayModal");
  modal?.classList.add("is-open");
  modal?.setAttribute("aria-hidden", "false");
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
  if (order.status === "CANCELED") {
    return order.statusMessage || "已取消订单";
  }
  if (order.status === "AMOUNT_MISMATCH") {
    return order.statusMessage || "支付金额异常，已暂停入账";
  }
  return "订单码已关闭，暂未检测到支付";
}

function addPaidRechargeRecord(order) {
  const records = getStoredRechargeRecords();
  if (records.some((record) => record.orderNo === order.outTradeNo)) {
    return;
  }
  addRechargeRecord({
    orderNo: order.outTradeNo,
    method: "支付宝",
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
  addPaidRechargeRecord(order);
  await renderRechargeSummary();
  closeAlipayModal();
  activeAlipayOrder = null;
  showCopyToast("订单支付成功，积分已到账");
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
      if (["CLOSED", "CANCELED", "AMOUNT_MISMATCH", "REFUNDED"].includes(order.status)) {
        stopAlipayPolling();
        closeAlipayModal();
        activeAlipayOrder = null;
        showCopyToast(getAlipayCloseMessage(order));
      }
    }
    return order;
  })();

  try {
    return await alipaySyncPromise;
  } catch (error) {
    console.warn("failed to sync alipay order", error);
    if (source !== "poll") {
      showCopyToast(error.message || "支付确认失败");
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
  showCopyToast(getAlipayCloseMessage(order));
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
    if (payment === "wechat") {
      showCopyToast("暂未开通微信支付");
      return;
    }

    const submitButton = onlineForm.querySelector(".recharge-submit");
    submitButton.disabled = true;
    submitButton.textContent = "创建订单中...";

    try {
      const created = await rechargeApiRequest("/api/v1/recharge-orders", {
        method: "POST",
        body: JSON.stringify({
          amount,
          provider: "alipay",
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

  offlineForm?.addEventListener("submit", (event) => {
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
    addRechargeRecord({
      orderNo: `OF${Date.now()}`,
      method: "对公转账",
      amount,
      points: getRechargePoints(amount),
      status: "审核中",
      createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    window.alert("线下充值申请已提交，运营审核通过后积分将自动入账。");
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
  window.addEventListener("beforeunload", stopAlipayPolling);
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

function initRechargeCenter() {
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
