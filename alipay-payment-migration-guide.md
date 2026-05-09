# 支付宝支付迁移接入文档

本文档基于当前项目 `E:\CodeX\Pay` 的实际代码整理，目标是把支付宝支付迁移到另一个项目时，可以按模块、按接口、按状态机逐步复刻。

当前项目里支付宝有两套相关能力：

- 主流程：支付宝订单码支付，也就是用户扫商家二维码付款，核心 API 是 `alipay.trade.precreate`。
- 保留能力：电脑网站支付表单跳转，核心 API 是 `alipay.trade.page.pay`，当前代码中有构造逻辑，但前端主流程实际展示的是 `precreate` 返回的二维码。

官方参考文档：

- 订单码支付：<https://ideservice.alipay.com/cms/site/0izg0z>
- 电脑网站支付：<https://ideservice.alipay.com/cms/site/0iztfv>
- 接口加签方式：<https://ideservice.alipay.com/cms/site/0j3u72>
- 接入规范和安全红线：<https://ideservice.alipay.com/cms/site/0j0kl2>
- 支付宝沙箱网关：`https://openapi-sandbox.dl.alipaydev.com/gateway.do`
- 支付宝正式网关：`https://openapi.alipay.com/gateway.do`

## 1. 当前项目文件分工

支付宝迁移时重点关注这些文件：

| 文件 | 作用 |
| --- | --- |
| `src/alipay.js` | 支付宝公共能力：网关地址、密钥读取、PEM 格式化、签名、验签、构造请求参数、调用支付宝网关 |
| `server.js` | 业务流程：创建订单、生成二维码、轮询查询、取消订单、异步通知处理、PC 支付表单渲染 |
| `src/db.js` | MySQL 数据访问：订单、商品、支付事件的创建、查询、更新 |
| `db/schema.sql` | 数据表结构：`orders`、`order_items`、`payment_events` 等 |
| `public/app.js` | 前端收银台：创建订单、请求二维码、展示弹窗、轮询订单状态、取消订单 |
| `public/return.html` | 支付同步跳转结果页。只展示结果，不作为可信支付依据 |
| `.env.example` | 环境变量示例，包含支付宝 app id、密钥路径、网关、回调域名、数据库配置 |
| `test/alipay.test.js` | 支付宝签名、验签、参数构造单测 |
| `test/server-routes.test.js` | 支付宝业务状态转换和路由解析单测 |

## 2. 迁移前置条件

### 2.1 支付宝开放平台配置

迁移到新项目之前，需要先准备：

1. 支付宝开放平台应用。
2. 已签约对应产品。当前主流程是订单码支付，需要开通订单码支付能力。
3. 应用私钥。商户服务端用来给请求签名。
4. 应用公钥。上传到支付宝开放平台。
5. 支付宝公钥。服务端用来验证支付宝异步通知签名。
6. 可公网访问的 `notify_url`。支付宝异步通知必须能从公网访问，本地 `localhost` 不可用于真实回调。
7. 生产环境建议配置 `seller_id` 校验，避免错误商户通知被接受。

### 2.2 环境变量

当前项目通过 `.env.local` 或 `.env` 加载配置，`.env.example` 中与支付宝相关的字段如下：

```env
PORT=3000
BASE_URL=http://localhost:3000

# sandbox 或 production
ALIPAY_ENV=sandbox
ALIPAY_APP_ID=2021006147683503

# 推荐使用密钥文件，避免多行 PEM 被环境变量破坏
ALIPAY_PRIVATE_KEY_PATH=./keys/app_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=./keys/alipay_public_key.pem

# 也支持直接传密钥内容，换行用 \n
ALIPAY_PRIVATE_KEY=
ALIPAY_PUBLIC_KEY=

# 可选。配置后异步通知会校验 seller_id
ALIPAY_SELLER_ID=
```

迁移建议：

- 开发和沙箱环境：`ALIPAY_ENV=sandbox`，网关使用沙箱网关。
- 正式环境：`ALIPAY_ENV=production`，网关使用正式网关。
- `BASE_URL` 必须是外部可访问的 HTTPS 域名，例如 `https://pay.example.com`。
- 私钥不要写入客户端，不要打印到日志，不要提交到仓库。
- `.env.local`、`.env`、`keys/` 里的真实密钥文件应加入 `.gitignore` 或由密钥管理系统托管。

当前项目默认根据 `ALIPAY_ENV` 选择网关：

```js
const SANDBOX_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";
const PRODUCTION_GATEWAY = "https://openapi.alipay.com/gateway.do";

function getGateway(env = "sandbox") {
  return env === "production" ? PRODUCTION_GATEWAY : SANDBOX_GATEWAY;
}
```

## 3. 数据库表设计

支付宝迁移最少需要保存订单、订单明细、支付事件。

### 3.1 `orders`

当前项目的订单表核心字段：

| 字段 | 说明 |
| --- | --- |
| `out_trade_no` | 商户订单号，调用支付宝时传入，必须唯一 |
| `client_token_hash` | 前端访问订单敏感接口的令牌哈希，防止只靠订单号操作订单 |
| `subject` | 订单标题，传给支付宝 `subject` |
| `total_amount` | 支付金额，单位元，保留 2 位小数 |
| `status` | 本地订单状态 |
| `status_message` | 给前端展示的状态文案 |
| `provider` | 支付渠道，当前项目可为 `alipay`、`wechat`、`mock` |
| `qr_code` | 支付宝返回的二维码内容 |
| `qr_code_data_url` | 本地生成的二维码图片 Data URL |
| `alipay_trade_no` | 支付宝交易号 |
| `alipay_trade_status` | 支付宝交易状态 |
| `paid_at` | 支付成功时间 |
| `canceled_at` | 本地取消时间 |
| `closed_at` | 交易关闭或退款关闭时间 |
| `last_checked_at` | 最近一次主动查询时间 |

### 3.2 `payment_events`

当前项目会把支付宝通知、查询、取消等结果写入事件表：

| 字段 | 说明 |
| --- | --- |
| `order_id` | 关联本地订单 |
| `event_type` | 事件类型，例如 `alipay.notify`、`alipay.paid`、`alipay.query`、`alipay.cancel` |
| `payload_json` | 原始支付宝响应或通知参数 |
| `created_at` | 事件写入时间 |

迁移建议：

- 支付事件表非常重要，用于排查支付状态、回调重放、金额不一致等问题。
- 原始通知参数必须在验签前后都能定位。当前项目只有找到本地订单时才记录通知事件；新项目可以考虑即使订单不存在也记录到独立审计表。
- 支付金额用数据库 `DECIMAL(10,2)`，不要用浮点数作为持久化金额类型。

## 4. 支付宝工具模块 `src/alipay.js`

迁移时建议先把 `src/alipay.js` 拆成独立服务模块。它不依赖具体业务，只负责支付宝协议层。

### 4.1 密钥读取和 PEM 标准化

当前项目支持两种密钥来源：

- 环境变量直接传密钥内容。
- 环境变量传密钥文件路径。

`normalizePem(value, label)` 的作用：

- 如果值里已经有 `BEGIN`，认为是完整 PEM，直接返回。
- 如果值是压成一行的 base64，会自动每 64 字符换行并补齐 PEM 头尾。
- 支持环境变量中使用 `\n` 表示换行。

迁移注意：

- 应用私钥使用 `PRIVATE KEY` 标签。
- 支付宝公钥使用 `PUBLIC KEY` 标签。
- 支付宝公钥不是应用公钥。应用公钥上传给支付宝，支付宝公钥保存到商户服务端用于验签。

### 4.2 签名内容构造

当前项目的签名规则：

```js
function buildSignContent(params) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .filter((key) => key !== "sign")
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}
```

要点：

- 排除 `undefined`、`null`、空字符串。
- 排除 `sign` 字段。
- 不排除 `sign_type`。`sign_type` 必须参与签名。
- 参数名按字典序排序。
- 拼接格式是 `key=value&key=value`。

### 4.3 RSA2 签名

当前项目使用 Node.js 原生 `crypto`：

```js
function signParams(params, privateKey) {
  const signContent = buildSignContent(params);
  return crypto.createSign("RSA-SHA256")
    .update(signContent, "utf8")
    .sign(privateKey, "base64");
}
```

对应公共参数：

```js
sign_type: "RSA2"
```

### 4.4 验签

验签使用支付宝公钥：

```js
function verifyParams(params, publicKey) {
  const signature = params.sign;
  if (!signature || !publicKey) return false;
  const signContent = buildSignContent(params);
  return crypto.createVerify("RSA-SHA256")
    .update(signContent, "utf8")
    .verify(publicKey, signature, "base64");
}
```

迁移注意：

- 异步通知必须先验签，再执行业务状态变更。
- 验签使用支付宝公钥，不是应用公钥。
- 不要把验签失败的通知当成功处理。

## 5. 支付参数构造

### 5.1 订单码支付：`alipay.trade.precreate`

当前主流程使用 `buildPrecreateParams`：

```js
function buildPrecreateParams({ appId, notifyUrl, bizContent, timestamp }) {
  return {
    app_id: appId,
    method: "alipay.trade.precreate",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: timestamp || formatAlipayTimestamp(),
    version: "1.0",
    notify_url: notifyUrl,
    biz_content: JSON.stringify(bizContent),
  };
}
```

当前项目传给 `biz_content` 的内容由 `buildPrecreateBizContent(order)` 生成：

```js
{
  out_trade_no: order.outTradeNo,
  total_amount: order.totalAmount,
  subject: order.subject,
  product_code: "QR_CODE_OFFLINE",
  goods_detail: [
    {
      goods_id: order.sku,
      goods_name: order.subject,
      quantity: order.quantity,
      price: Number(order.unitPrice).toFixed(2),
    },
  ],
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `out_trade_no` | 商户订单号，必须唯一，当前格式 `PAY_${Date.now()}_${随机6位}` |
| `total_amount` | 订单总金额，单位元，字符串格式如 `"0.01"` |
| `subject` | 订单标题 |
| `product_code` | 订单码支付使用 `QR_CODE_OFFLINE` |
| `goods_detail` | 商品明细，可选但建议传，便于账务和排查 |

支付宝调用成功后，`callAlipay` 返回响应体，其中 `qr_code` 是二维码内容。当前项目再用 `qrcode` npm 包把它转成图片 Data URL 给前端展示。

### 5.2 主动查询：`alipay.trade.query`

当前项目用 `buildQueryParams` 构造查询参数：

```js
function buildQueryParams({ appId, bizContent, timestamp }) {
  return {
    app_id: appId,
    method: "alipay.trade.query",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: timestamp || formatAlipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
}
```

查询时只传：

```js
{
  out_trade_no: order.outTradeNo
}
```

查询接口是当前项目的兜底确认机制：

- 前端每 5 秒调用 `/api/orders/:outTradeNo/sync`。
- 后端调用 `alipay.trade.query`。
- 根据支付宝返回的 `trade_status` 更新本地订单。
- 如果未收到异步通知，也能通过查询确认支付成功。

### 5.3 取消交易：`alipay.trade.cancel`

当前项目用 `buildCancelParams`：

```js
function buildCancelParams({ appId, bizContent, timestamp }) {
  return {
    app_id: appId,
    method: "alipay.trade.cancel",
    format: "JSON",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: timestamp || formatAlipayTimestamp(),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
}
```

取消时传：

```js
{
  out_trade_no: order.outTradeNo
}
```

当前项目在用户关闭支付弹窗时会调用取消接口。取消前会先查询一次订单状态，如果已经支付成功，则不取消。

注意：

- 支付宝 `cancel` 对部分场景可能是关闭未支付交易，也可能对已支付但可撤销交易产生撤销或退款动作。当前项目根据响应 `action === "refund"` 标记为 `REFUNDED`，否则标记 `CANCELED`。
- 生产项目需要结合业务判断是否允许用户关闭弹窗即取消订单。

### 5.4 电脑网站支付：`alipay.trade.page.pay`

当前项目保留了 `renderAlipayForm(order)` 和 `buildPaymentForm`，用于生成自动提交到支付宝网关的 HTML 表单。

参数构造：

```js
{
  app_id: appId,
  method: "alipay.trade.page.pay",
  format: "JSON",
  charset: "utf-8",
  sign_type: "RSA2",
  timestamp: "...",
  version: "1.0",
  notify_url: `${BASE_URL}/api/alipay/notify`,
  return_url: `${BASE_URL}/return.html?out_trade_no=${outTradeNo}`,
  biz_content: JSON.stringify({
    out_trade_no: order.outTradeNo,
    total_amount: order.totalAmount,
    subject: order.subject,
    product_code: "FAST_INSTANT_TRADE_PAY",
    integration_type: "PCWEB",
    goods_detail: [...]
  })
}
```

如果新项目想做跳转到支付宝收银台，而不是本地二维码弹窗，可以使用这条链路。

重要区别：

- `page.pay` 的 `product_code` 是 `FAST_INSTANT_TRADE_PAY`。
- `precreate` 的 `product_code` 是 `QR_CODE_OFFLINE`。
- `page.pay` 有 `return_url` 同步跳转，但同步跳转结果不可信。
- 两种方式都应配置 `notify_url`，并以异步通知或主动查询结果为准。

## 6. 支付宝网关调用

当前项目的 `callAlipay` 是所有支付宝 OpenAPI 的通用调用函数：

1. 复制参数。
2. 使用应用私钥签名。
3. 用 `application/x-www-form-urlencoded; charset=utf-8` POST 到网关。
4. 解析 JSON。
5. 找到响应体中以 `_response` 结尾的字段。
6. 校验 `responseBody.code === "10000"`。
7. 非 `10000` 时抛出错误，并带上 `code`、`sub_code`、`sub_msg`。

伪代码：

```js
async function callAlipay({ gateway, params, privateKey }) {
  const signedParams = { ...params, sign: signParams(params, privateKey) };
  const body = new URLSearchParams();

  for (const [key, value] of Object.entries(signedParams)) {
    if (value !== undefined && value !== null && value !== "") {
      body.append(key, String(value));
    }
  }

  const response = await fetch(gateway, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" },
    body: body.toString(),
  });

  const data = await response.json();
  const responseKey = Object.keys(data).find((k) => k.endsWith("_response"));
  const responseBody = responseKey ? data[responseKey] : data;

  if (responseBody.code !== "10000") {
    throw new Error(responseBody.sub_msg || responseBody.msg || "Alipay API error");
  }

  return responseBody;
}
```

迁移建议：

- 生产环境日志可以记录 `code`、`sub_code`、`sub_msg`、`out_trade_no`，不要记录私钥。
- 如果要记录支付宝完整响应，注意脱敏用户账号等敏感信息。
- 调用失败不代表未支付，尤其是网络超时或系统错误。后续必须通过查询接口确认。

## 7. 后端完整流程

### 7.1 创建本地订单

入口：

```http
POST /api/orders
Content-Type: application/json

{
  "quantity": 1,
  "provider": "alipay"
}
```

当前项目执行逻辑：

1. 读取固定商品 `bean-kit-01`。
2. 校验商品是否存在且启用。
3. 限制数量范围 1 到 5。
4. 计算总金额：`product.unitPrice * quantity`，保留 2 位小数。
5. 生成商户订单号：`PAY_${Date.now()}_${随机6位}`。
6. 生成 `clientToken`，只返回给当前前端。
7. 把 `clientToken` 的 SHA-256 哈希保存到订单表。
8. 写入 `orders` 和 `order_items`。
9. 根据支付宝配置是否完整，决定 `provider` 是 `alipay` 还是降级到 `mock`。
10. 返回订单、`orderToken`、支付页 URL。

响应示例：

```json
{
  "order": {
    "outTradeNo": "PAY_1778058285426_5VP6HY",
    "subject": "商品名称",
    "quantity": 1,
    "totalAmount": "0.01",
    "status": "CREATED",
    "provider": "alipay"
  },
  "orderToken": "随机令牌",
  "paymentUrl": "/pay/PAY_1778058285426_5VP6HY"
}
```

迁移注意：

- `out_trade_no` 必须全局唯一，不要重复使用。
- 支付金额必须来自服务端商品和订单计算，不能信任前端传入金额。
- 订单创建后本地状态是 `CREATED`。
- 对订单查询、二维码生成、取消等接口建议加访问令牌或用户权限校验。当前项目使用 `x-order-token`。

### 7.2 生成支付宝二维码

入口：

```http
GET /api/orders/:outTradeNo/qrcode
X-Order-Token: 前端持有的 orderToken
```

当前项目执行逻辑：

1. 解析 `outTradeNo`。
2. 查询本地订单。
3. 校验订单存在。
4. 校验 `x-order-token` 是否匹配本地 `client_token_hash`。
5. 如果订单已经处于最终状态，返回 `ORDER_NOT_PAYABLE`。
6. 如果支付宝配置缺失，返回 `ALIPAY_NOT_CONFIGURED`。
7. 如果本地已有 `qr_code` 和 `qr_code_data_url`，直接返回缓存，避免重复预创建。
8. 调用 `createAlipayQrCode(order)`。
9. `createAlipayQrCode` 构造 `alipay.trade.precreate` 请求。
10. 支付宝返回 `qr_code`。
11. 用 `qrcode` npm 包生成二维码图片 Data URL。
12. 更新订单：
    - `qr_code`
    - `qr_code_data_url`
    - `status = QR_READY`
    - `status_message`
    - `updated_at`
13. 返回二维码内容和图片。

响应示例：

```json
{
  "qrCode": "https://qr.alipay.com/...",
  "qrCodeDataUrl": "data:image/png;base64,...",
  "outTradeNo": "PAY_1778058285426_5VP6HY"
}
```

### 7.3 前端展示二维码并轮询

当前 `public/app.js` 的前端流程：

1. 用户点击“使用支付宝支付”。
2. 前端调用 `POST /api/orders` 创建订单。
3. 前端得到 `outTradeNo` 和 `orderToken`。
4. 前端调用 `GET /api/orders/:outTradeNo/qrcode` 请求二维码。
5. 前端把 `qrCodeDataUrl` 放到 `<img>` 显示。
6. 弹窗打开后立即调用一次 `refreshActiveOrder()`。
7. 每 5 秒轮询一次：

```http
GET /api/orders/:outTradeNo/sync
X-Order-Token: orderToken
```

8. 如果订单变成 `PAID` 或其他最终状态，关闭弹窗，停止轮询。

当前轮询间隔：

```js
const STATUS_POLL_INTERVAL_MS = 5000;
```

迁移建议：

- 前端轮询只是改善体验，不能替代异步通知。
- 轮询接口应该做限流，避免用户长时间停留造成过多查询。
- 支付完成后应停止轮询。
- 前端不要自行判断支付成功，必须使用后端返回的本地订单状态。

### 7.4 主动同步订单状态

入口：

```http
GET /api/orders/:outTradeNo/sync
X-Order-Token: orderToken
```

当前项目执行逻辑：

1. 查询本地订单。
2. 校验订单令牌。
3. 如果订单是支付宝订单，调用 `syncOrderWithAlipay(order)`。
4. 如果支付宝配置缺失、订单不是 `alipay`、或订单已经是最终状态，则直接返回订单。
5. 构造并调用 `alipay.trade.query`。
6. 根据查询结果更新本地状态。
7. 如果状态发生变化，写入 `payment_events`。
8. 持久化订单状态。

特殊错误处理：

```js
if (error.subCode === "ACQ.TRADE_NOT_EXIST") {
  return { out_trade_no: order.outTradeNo, trade_status: "TRADE_NOT_FOUND" };
}
if (error.code === "10003") {
  return { out_trade_no: order.outTradeNo, trade_status: "WAIT_BUYER_PAY" };
}
```

含义：

- `ACQ.TRADE_NOT_EXIST`：支付宝侧还没有查到交易，本地回退到二维码已生成或订单已创建状态。
- `10003`：当前项目按等待买家支付处理。

### 7.5 支付宝异步通知

入口：

```http
POST /api/alipay/notify
Content-Type: application/x-www-form-urlencoded
```

当前项目处理逻辑：

1. 读取表单参数。
2. 根据 `params.out_trade_no` 查询本地订单。
3. 使用支付宝公钥验签。
4. 校验订单存在。
5. 校验 `params.app_id === config.appId`。
6. 校验 `params.total_amount` 与本地订单金额一致。
7. 如果配置了 `ALIPAY_SELLER_ID`，校验 `params.seller_id === config.sellerId`。
8. 仅当 `trade_status` 是 `TRADE_SUCCESS` 或 `TRADE_FINISHED` 时认为支付成功。
9. 找到订单时记录 `payment_events`，事件类型 `alipay.notify`。
10. 全部校验通过后：
    - 标记本地订单为 `PAID`
    - 保存支付宝交易号 `trade_no`
    - 更新 `paid_at`
    - 返回纯文本 `success`
11. 任一校验失败则返回纯文本 `failure`。

关键判断：

```js
const validSignature = verifyParams(params, config.publicKey);
const validOrder = Boolean(order);
const validApp = params.app_id === config.appId;
const validAmount = order && amountsMatch(params.total_amount, order.totalAmount);
const validSeller = !config.sellerId || params.seller_id === config.sellerId;
const paid = params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED";
```

迁移注意：

- 异步通知接口必须能重复接收。支付宝可能重试通知。
- 处理逻辑必须幂等。当前 `markOrderPaid` 如果订单已经是 `PAID` 会直接返回。
- 返回 `success` 表示商户已成功接收，支付宝通常不再继续重试。
- 返回 `failure` 表示未成功处理，支付宝可能继续通知。
- 不要在异步通知接口里只凭 `trade_status` 改状态，必须同时验证签名、订单号、金额、应用 ID、商户 ID。

### 7.6 用户关闭弹窗取消订单

入口：

```http
POST /api/orders/:outTradeNo/cancel
X-Order-Token: orderToken
```

当前项目执行逻辑：

1. 查询本地订单。
2. 校验令牌。
3. 先调用 `syncOrderWithProvider(order)` 查询最新状态。
4. 如果查询后发现已经支付，直接返回已支付订单，不取消。
5. 如果是支付宝订单且不是最终状态，调用 `alipay.trade.cancel`。
6. 写入支付事件 `alipay.cancel`。
7. 根据支付宝响应标记：
    - `action === "refund"`：本地 `REFUNDED`
    - 其他：本地 `CANCELED`
8. 持久化订单。

迁移注意：

- 不建议未查询状态就取消，因为用户可能刚完成支付但异步通知还没到。
- 取消失败时不要随意把本地订单标记为取消，应保留原状态并提示稍后查询。
- 如果业务不允许关闭弹窗取消订单，可以移除前端关闭即取消的逻辑，只保留后台超时关单。

## 8. 订单状态机

当前项目的本地订单状态：

| 状态 | 含义 | 是否最终状态 |
| --- | --- | --- |
| `CREATED` | 本地订单已创建，尚未生成二维码 | 否 |
| `QR_READY` | 二维码已生成，等待用户扫码 | 否 |
| `WAITING_PAYMENT` | 等待扫码或等待支付确认 | 否 |
| `SCANNED` | 用户已扫码，等待在支付宝确认支付 | 否 |
| `PAID` | 支付成功 | 是 |
| `CANCELED` | 本地或支付渠道取消 | 是 |
| `CLOSED` | 支付渠道交易关闭 | 是 |
| `REFUNDED` | 已退款或撤销后退款 | 是 |
| `AMOUNT_MISMATCH` | 支付宝返回订单号或金额异常，暂停处理 | 是 |

最终状态集合：

```js
const FINAL_ORDER_STATUSES = new Set([
  "PAID",
  "CANCELED",
  "CLOSED",
  "REFUNDED",
  "AMOUNT_MISMATCH",
]);
```

支付宝查询状态到本地状态的映射：

| 支付宝 `trade_status` | 本地状态 | 处理逻辑 |
| --- | --- | --- |
| `TRADE_SUCCESS` | `PAID` | 支付成功，记录 `trade_no`、`paid_at` |
| `TRADE_FINISHED` | `PAID` | 交易完成，也视为支付成功 |
| `TRADE_CLOSED` | `CLOSED` | 交易关闭 |
| `WAIT_BUYER_PAY` 且有买家信号 | `SCANNED` | 有 `buyer_logon_id`、`buyer_user_id` 或 `buyer_open_id` 时认为已扫码 |
| `WAIT_BUYER_PAY` 且无买家信号 | `WAITING_PAYMENT` | 等待扫码或支付 |
| `TRADE_NOT_FOUND` | `QR_READY` 或 `CREATED` | 支付宝侧未找到交易，本地按二维码是否已生成回退 |

安全校验：

- 如果支付宝返回的 `out_trade_no` 与本地订单号不一致，标记 `AMOUNT_MISMATCH`。
- 如果支付宝返回的 `total_amount` 与本地金额不一致，标记 `AMOUNT_MISMATCH`。
- `AMOUNT_MISMATCH` 是最终状态，需要人工介入排查。

金额比较函数：

```js
function amountsMatch(alipayAmount, orderAmount) {
  return Number(alipayAmount).toFixed(2) === Number(orderAmount).toFixed(2);
}
```

迁移建议：

- 金额比较更稳妥的做法是统一转换成分或使用 Decimal 库，避免浮点边界问题。
- 支付成功后的发货、开通会员、增加余额等业务动作应只由订单状态从非 `PAID` 变成 `PAID` 的那一次触发。
- 如果异步通知和主动查询同时到达，要保证幂等，避免重复发货。

## 9. 前端迁移说明

当前前端支付宝支付主流程在 `public/app.js`：

### 9.1 初始化配置

页面加载后调用：

```http
GET /api/config
```

获取：

- 商品单价。
- 是否已配置支付宝。
- 当前支付模式。

如果支付宝配置缺失，当前项目会降级到本地 mock 支付。新项目可选择：

- 直接隐藏支付宝入口。
- 显示“支付暂不可用”。
- 开发环境使用 mock。

### 9.2 发起支付

点击支付宝按钮：

```js
alipayButton.addEventListener("click", () => createOrder("alipay"));
```

`createOrder("alipay")`：

1. 禁用支付按钮，防止重复点击。
2. 调用 `POST /api/orders`。
3. 拿到 `order.outTradeNo`、`orderToken`、`paymentUrl`。
4. 调用 `showPaymentModal(...)`。

### 9.3 获取二维码

真实支付宝订单不会直接用 iframe 打开 `/pay/:outTradeNo`，而是请求：

```http
GET /api/orders/:outTradeNo/qrcode
X-Order-Token: orderToken
```

拿到 `qrCodeDataUrl` 后展示 `<img>`。

### 9.4 轮询订单状态

非 mock 支付调用：

```http
GET /api/orders/:outTradeNo/sync
X-Order-Token: orderToken
```

mock 支付调用：

```http
GET /api/orders/:outTradeNo
```

当前项目在 `PAID` 或最终状态时关闭弹窗。

迁移建议：

- 轮询间隔建议 3 到 5 秒。
- 可以设置最大轮询时长，例如 5 到 15 分钟。
- 超时后不要自动判定失败，应提示用户稍后在订单页查看，后端继续允许异步通知更新状态。

## 10. `return_url` 同步跳转页

当前 `public/return.html` 明确体现一个原则：

> 浏览器同步跳转只作为提示，订单只有在异步通知或可信查询确认后，才视为已支付。

当前同步结果页逻辑：

1. 从 URL 查询参数读取 `out_trade_no`。
2. 调用：

```http
GET /api/orders/:outTradeNo
```

3. 展示本地订单状态。
4. 如果不是 `PAID`，提示尚未确认。

迁移建议：

- 如果使用 `page.pay`，`return_url` 页面应该主动调用后端查询或读取后端已确认状态。
- 不要因为用户跳回 `return_url` 就发货。
- `return_url` 可能被用户伪造访问。

## 11. 支付安全注意事项

### 11.1 必须服务端签名

应用私钥只能在服务端使用：

- 不能保存在前端。
- 不能下发到 App、小程序、网页。
- 不能写进 JS bundle。
- 不能出现在日志。

### 11.2 异步通知必须验签

通知处理顺序应为：

1. 接收参数。
2. 验证签名。
3. 查询本地订单。
4. 校验 `app_id`。
5. 校验 `seller_id` 或 `seller_email`。
6. 校验金额。
7. 校验交易状态。
8. 幂等更新本地订单。
9. 触发业务履约。
10. 返回 `success`。

### 11.3 前端结果不可信

不可信来源：

- 前端点击成功按钮。
- 浏览器同步跳转。
- URL 参数里的 `out_trade_no`。
- 前端传入的金额、商品名、用户 ID。

可信来源：

- 支付宝异步通知，且验签通过，金额和订单匹配。
- 商户服务端主动调用 `alipay.trade.query`，且结果和本地订单匹配。

### 11.4 金额必须二次校验

当前项目在异步通知和查询结果里都校验金额：

- 支付宝金额：`total_amount`
- 本地金额：`order.totalAmount`

不一致时标记 `AMOUNT_MISMATCH`，不发货。

### 11.5 订单号必须校验

支付宝返回的 `out_trade_no` 必须等于本地订单号。否则不能更新原订单为成功。

### 11.6 幂等处理

支付成功处理必须支持重复调用：

- 异步通知可能重复。
- 前端轮询可能和通知同时发生。
- 用户可能刷新页面。
- 服务端可能重试。

当前项目 `markOrderPaid(order, data)` 中如果订单已经是 `PAID`，会直接返回，避免重复处理。

新项目如果有发货、开通会员等履约逻辑，建议增加独立的履约状态或幂等表，例如：

- `fulfillment_status`
- `paid_event_id`
- `membership_order_id`
- 唯一键防重复发放

### 11.7 关闭和退款要谨慎

当前项目用户关闭支付窗口会尝试取消订单。迁移到生产项目时需要结合业务：

- 电商订单：关闭弹窗不一定等于取消订单，可能只是不再显示二维码。
- 虚拟商品：支付成功后不能重复开通。
- 超时关单建议由服务端定时任务处理。
- 调用 `cancel` 前必须先查询状态。

## 12. 迁移到新项目的推荐模块划分

建议新项目按以下结构迁移：

```text
src/
  payments/
    alipay/
      alipayClient.js      # 签名、验签、网关调用
      alipayConfig.js      # 环境变量、密钥读取
      alipayOrders.js      # precreate/query/cancel 参数构造
      alipayNotify.js      # 异步通知校验和状态更新
  orders/
    orderRepository.js     # 订单读写
    orderService.js        # 创建订单、状态机、履约
  routes/
    paymentRoutes.js       # /api/orders、/qrcode、/sync、/cancel、/notify
```

如果新项目是 Express/Koa/NestJS，也可以保留当前逻辑，只替换 HTTP 路由层。

## 13. 迁移步骤清单

### 第 1 步：安装依赖

当前项目依赖：

```bash
npm install mysql2 qrcode
```

Node.js 版本要求：

```json
{
  "engines": {
    "node": ">=20"
  }
}
```

如果新项目使用支付宝官方 SDK，可以不用当前手写签名和 `fetch` 调用方式，但仍要保留本文档中的业务校验和状态机。

### 第 2 步：迁移配置

复制或重新实现：

- `ALIPAY_ENV`
- `ALIPAY_APP_ID`
- `ALIPAY_PRIVATE_KEY_PATH`
- `ALIPAY_PUBLIC_KEY_PATH`
- `ALIPAY_SELLER_ID`
- `BASE_URL`

确认：

- `BASE_URL/api/alipay/notify` 外网可访问。
- 沙箱应用使用沙箱网关和沙箱密钥。
- 正式应用使用正式网关和正式密钥。
- 支付宝公钥和应用私钥是一组正确配置。

### 第 3 步：迁移支付宝客户端

从 `src/alipay.js` 迁移：

- `getGateway`
- `formatAlipayTimestamp`
- `normalizePem`
- `readKey`
- `buildSignContent`
- `signParams`
- `verifyParams`
- `buildPrecreateParams`
- `buildQueryParams`
- `buildCancelParams`
- `callAlipay`

如需 PC 网站支付，再迁移：

- `buildPaymentParams`
- `buildPaymentForm`

### 第 4 步：迁移订单表字段

至少需要：

```sql
out_trade_no          VARCHAR(64) UNIQUE NOT NULL
subject               VARCHAR(255) NOT NULL
total_amount          DECIMAL(10,2) NOT NULL
status                VARCHAR(32) NOT NULL
provider              VARCHAR(32) NOT NULL
qr_code               VARCHAR(1024) NULL
qr_code_data_url      MEDIUMTEXT NULL
alipay_trade_no       VARCHAR(64) NULL
alipay_trade_status   VARCHAR(32) NULL
paid_at               DATETIME NULL
canceled_at           DATETIME NULL
closed_at             DATETIME NULL
last_checked_at       DATETIME NULL
created_at            DATETIME NOT NULL
updated_at            DATETIME NOT NULL
```

建议额外保留：

- `user_id`
- `client_token_hash`
- `status_message`
- `payment_events`
- 订单明细表

### 第 5 步：创建订单接口

新项目创建订单时必须：

1. 服务端读取商品和价格。
2. 服务端计算金额。
3. 生成唯一 `out_trade_no`。
4. 写入本地订单，状态 `CREATED`。
5. 返回订单号和访问令牌。

不要：

- 从前端接收金额后直接传给支付宝。
- 不落库就直接调用支付宝。
- 重复使用同一个 `out_trade_no`。

### 第 6 步：生成二维码接口

实现：

```http
GET /api/orders/:outTradeNo/qrcode
```

核心逻辑：

1. 校验当前用户或订单令牌。
2. 校验订单不是最终状态。
3. 如果已有二维码，直接返回缓存。
4. 调用 `alipay.trade.precreate`。
5. 保存 `qr_code`。
6. 生成二维码图片或让前端自己根据 `qr_code` 生成二维码。
7. 更新订单状态为 `QR_READY`。

### 第 7 步：同步查询接口

实现：

```http
GET /api/orders/:outTradeNo/sync
```

核心逻辑：

1. 校验权限。
2. 如果订单已是最终状态，直接返回。
3. 调用 `alipay.trade.query`。
4. 处理 `TRADE_SUCCESS`、`TRADE_FINISHED`、`TRADE_CLOSED`、`WAIT_BUYER_PAY`。
5. 校验金额和订单号。
6. 状态变化时记录事件。
7. 返回本地订单状态。

### 第 8 步：异步通知接口

实现：

```http
POST /api/alipay/notify
```

必须做：

1. 使用支付宝公钥验签。
2. 校验订单存在。
3. 校验 `app_id`。
4. 校验 `seller_id`。
5. 校验 `total_amount`。
6. 只接受 `TRADE_SUCCESS` 或 `TRADE_FINISHED`。
7. 幂等标记本地订单 `PAID`。
8. 触发业务履约。
9. 返回纯文本 `success`。

失败返回：

```text
failure
```

### 第 9 步：取消或超时关单

实现：

```http
POST /api/orders/:outTradeNo/cancel
```

或用定时任务处理过期订单。

推荐逻辑：

1. 先查本地订单。
2. 如果已支付，禁止取消。
3. 主动调用 `alipay.trade.query` 确认最新状态。
4. 仍未支付时调用 `alipay.trade.cancel`。
5. 更新本地状态。

### 第 10 步：前端接入

前端需要：

1. 创建订单。
2. 请求二维码。
3. 展示二维码。
4. 轮询后端同步接口。
5. 最终以服务端返回订单状态为准。
6. 支付成功后跳转订单结果页或刷新订单状态。

## 14. 测试建议

当前项目已有单测覆盖：

- 签名内容排序和排除字段。
- RSA2 签名和验签。
- `page.pay` 表单构造。
- `precreate` 参数构造。
- `query` 参数构造。
- `cancel` 参数构造。
- 通知被篡改后验签失败。
- 支付宝查询结果金额一致才标记成功。
- 金额不一致标记 `AMOUNT_MISMATCH`。
- `WAIT_BUYER_PAY` 根据买家信号映射为 `SCANNED`。

迁移后建议补充：

1. 异步通知重复投递不会重复发货。
2. 异步通知金额不一致不会发货。
3. 异步通知 `app_id` 不一致不会发货。
4. 异步通知 `seller_id` 不一致不会发货。
5. 查询接口支付成功能更新订单。
6. 查询接口交易关闭能更新订单。
7. 取消前如果查询到已支付，不会取消订单。
8. 二维码接口重复调用不会重复创建支付宝交易。
9. 支付宝网关超时时订单保持可查询状态。
10. `return_url` 访问不会直接改变订单支付状态。

运行当前项目测试：

```bash
npm test
```

## 15. 常见问题和排查

### 15.1 支付宝返回签名错误

检查：

- 应用私钥是否和上传到支付宝的应用公钥匹配。
- 是否使用了 RSA2，对应 `RSA-SHA256`。
- `sign_type` 是否参与签名。
- 参数排序是否正确。
- `biz_content` 是否在签名前已经 JSON 字符串化。
- 环境是否混用：沙箱 app id + 正式网关，或正式 app id + 沙箱网关。

当前项目提供了 `debug-sign.js` 用于排查应用私钥、公钥匹配关系。

### 15.2 异步通知验签失败

检查：

- 是否使用支付宝公钥验签，而不是应用公钥。
- 通知参数解析后是否保留了原始字段值。
- 是否错误排除了 `sign_type`。
- 是否把 `sign` 参与了验签内容。
- 是否对参数做了额外 URL decode、转义、重排或改值。

### 15.3 支付成功但页面一直未更新

检查：

- `/api/alipay/notify` 是否公网可访问。
- `BASE_URL` 是否正确。
- 支付宝应用后台是否配置了正确的授权和产品能力。
- 服务器是否能访问支付宝网关。
- `/api/orders/:outTradeNo/sync` 是否调用成功。
- 查询接口是否返回 `TRADE_SUCCESS` 或 `TRADE_FINISHED`。

### 15.4 沙箱能用，正式不能用

检查：

- 正式应用是否已签约订单码支付。
- 正式应用公钥是否已上传。
- 正式支付宝公钥是否已下载并配置。
- `ALIPAY_ENV=production`。
- 网关是 `https://openapi.alipay.com/gateway.do`。
- `notify_url` 是 HTTPS 公网地址。

### 15.5 金额不一致

当前项目会进入 `AMOUNT_MISMATCH`，这是一种保护状态。

排查：

- 本地订单金额是否创建后被修改。
- 支付宝通知或查询返回的 `total_amount`。
- 是否重复使用了 `out_trade_no`。
- 是否前端传金额导致被篡改。
- 是否小数处理不一致。

## 16. 上线检查清单

上线前逐项确认：

- [ ] 使用正式支付宝应用和正式网关。
- [ ] 应用私钥只保存在服务端。
- [ ] 支付宝公钥配置正确。
- [ ] `notify_url` 是 HTTPS 且公网可访问。
- [ ] 异步通知先验签再处理。
- [ ] 校验 `app_id`。
- [ ] 校验 `seller_id`。
- [ ] 校验 `out_trade_no`。
- [ ] 校验 `total_amount`。
- [ ] 只把 `TRADE_SUCCESS`、`TRADE_FINISHED` 当支付成功。
- [ ] `return_url` 不直接发货。
- [ ] 未收到通知时可以通过 `alipay.trade.query` 兜底。
- [ ] 支付成功处理幂等。
- [ ] 取消订单前先查询状态。
- [ ] 支付事件有日志或表记录。
- [ ] 私钥不会进入日志、前端包、Git 仓库。
- [ ] 金额使用 `DECIMAL` 或整数分处理。
- [ ] 支付宝沙箱和正式环境配置隔离。
- [ ] 对支付接口做用户权限或订单令牌校验。
- [ ] 支付成功后的业务履约有防重复机制。

## 17. 最小可迁移伪代码

下面是一条最小的订单码支付链路：

```js
// 1. 创建本地订单
const order = await orders.create({
  outTradeNo: generateOutTradeNo(),
  subject: product.name,
  totalAmount: calculateAmount(product, quantity),
  status: "CREATED",
});

// 2. 生成二维码
const precreateParams = buildPrecreateParams({
  appId: config.appId,
  notifyUrl: `${config.baseUrl}/api/alipay/notify`,
  bizContent: {
    out_trade_no: order.outTradeNo,
    total_amount: order.totalAmount,
    subject: order.subject,
    product_code: "QR_CODE_OFFLINE",
  },
});
const precreateResult = await callAlipay({
  gateway: config.gateway,
  params: precreateParams,
  privateKey: config.privateKey,
});
await orders.update(order.outTradeNo, {
  qrCode: precreateResult.qr_code,
  status: "QR_READY",
});

// 3. 异步通知
app.post("/api/alipay/notify", async (req, res) => {
  const params = req.body;
  const order = await orders.findByOutTradeNo(params.out_trade_no);

  const accepted =
    verifyParams(params, config.alipayPublicKey) &&
    order &&
    params.app_id === config.appId &&
    params.seller_id === config.sellerId &&
    amountsMatch(params.total_amount, order.totalAmount) &&
    ["TRADE_SUCCESS", "TRADE_FINISHED"].includes(params.trade_status);

  if (!accepted) {
    res.type("text/plain").send("failure");
    return;
  }

  await orders.markPaidIdempotently(order.outTradeNo, {
    alipayTradeNo: params.trade_no,
    alipayTradeStatus: params.trade_status,
  });

  res.type("text/plain").send("success");
});

// 4. 主动查询兜底
const queryParams = buildQueryParams({
  appId: config.appId,
  bizContent: { out_trade_no: order.outTradeNo },
});
const queryResult = await callAlipay({
  gateway: config.gateway,
  params: queryParams,
  privateKey: config.privateKey,
});
await updateOrderFromAlipayQuery(order, queryResult);
```

## 18. 当前项目迁移时最容易漏的点

1. 主流程不是直接跳支付宝页面，而是 `precreate` 生成二维码。
2. `/pay/:outTradeNo` 虽然能渲染 `page.pay` 表单，但前端真实支付宝弹窗走的是 `/api/orders/:outTradeNo/qrcode`。
3. 前端轮询 `/sync` 会主动调用支付宝查询接口，不只是查本地库。
4. 异步通知成功条件很多，不是只判断 `trade_status`。
5. `return.html` 只是结果展示页，不可信。
6. 关闭支付弹窗会触发取消接口，取消前会先查询。
7. 二维码结果会缓存到订单表，避免重复创建。
8. `orderToken` 是当前项目保护订单接口的关键，不要迁移时删除权限校验。
9. `AMOUNT_MISMATCH` 是资金安全保护，不应自动改回成功。
10. 支付成功后的业务动作应放在服务端状态确认后，不应放在前端。
