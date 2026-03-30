# WF_002 手动接线说明

本文档说明 `WF_002` 这条链路如何纯手动配置和连接，包括：

- 工作流前端：`client-portal/wf002.html`
- 中台后端：`ai-mid-platform`
- n8n 后端工作流：`simple-prompt`

## 1. 当前链路结构

当前 `WF_002` 的完整调用关系是：

1. 用户在前端页面输入提示词
2. 前端调用中台接口 `POST /api/v1/workflows/WF-002/webhook-execute`
3. 中台先冻结积分，再请求 n8n webhook
4. n8n 调用 KIE 生图并等待最终结果
5. n8n 通过 `Respond to Webhook` 直接返回图片 URL
6. 中台把结果写回 `workflow_runs`
7. 前端展示图片和执行结果

当前正式 webhook 地址：

`https://n8n.deepsix.store/webhook/simple-prompt`

## 2. 前端如何手动接

前端文件：

- `/home/zzq/workspace/ai-workflow/client-portal/wf002.html`
- `/home/zzq/workspace/ai-workflow/client-portal/wf002.js`

前端当前调用的接口是：

`POST /api/v1/workflows/WF-002/webhook-execute`

对应代码位置：

- `wf002.js` 中：

```js
fetch(`${API_BASE}/api/v1/workflows/WF-002/webhook-execute`, {
  method: "POST",
  headers: buildHeaders(),
  body: JSON.stringify({ prompt }),
});
```

前端需要手动满足的条件：

1. 页面必须能拿到登录 token
2. token 会通过 `Authorization: Bearer <token>` 发送给中台
3. 提交 body 中至少要有：

```json
{
  "prompt": "你的提示词"
}
```

如果你以后换页面，只要保留这三个约定即可：

- 带 Bearer token
- 请求 `WF-002` 接口
- body 里传 `prompt`

## 3. 中台后端如何手动接

中台代码位置：

- `/home/zzq/workspace/ai-workflow/ai-mid-platform/src/workflows/workflows.controller.ts`
- `/home/zzq/workspace/ai-workflow/ai-mid-platform/src/workflows/workflow-execution.service.ts`

### 3.1 接口入口

中台暴露的接口：

`POST /api/v1/workflows/WF-002/webhook-execute`

作用：

1. 校验登录态
2. 冻结积分
3. 请求 n8n webhook
4. 读取 n8n 返回的图片地址
5. 成功后扣费并记录执行结果

### 3.2 中台必须配置的环境变量

文件：

`/home/zzq/workspace/ai-workflow/ai-mid-platform/.env`

当前 `WF_002` 相关配置：

```env
WF_002_WEBHOOK_URL=https://n8n.deepsix.store/webhook/simple-prompt
WF_002_WEBHOOK_TIMEOUT_MS=90000
```

含义：

- `WF_002_WEBHOOK_URL`
  n8n 正式 webhook 地址

- `WF_002_WEBHOOK_TIMEOUT_MS`
  中台等待 n8n 返回的最长时间，当前是 `90000ms`

如果你手动修改了 `.env`，要执行：

```bash
cd /home/zzq/workspace/ai-workflow/ai-mid-platform
npm run build
systemctl restart ai-mid-platform
```

### 3.3 中台发给 n8n 的请求内容

当前中台发送给 n8n 的 body 结构是：

```json
{
  "prompt": "用户输入的提示词",
  "run_id": "run_xxx",
  "client_request_id": "wf002_exec_xxx",
  "workflow_code": "WF-002",
  "user_id": 4
}
```

n8n 至少要能读取到：

- `body.prompt`

其他字段目前主要用于排查和扩展，不是强依赖。

## 4. n8n 后端如何手动接

### 4.1 Webhook 节点必须这样设置

`Webhook` 节点核心设置：

- `HTTP Method`: `POST`
- `Path`: `simple-prompt`
- `Response Mode`: `Using "Respond to Webhook" Node`

这三项缺一不可。

如果 `Response Mode` 不是 `Respond to Webhook`，外部请求就收不到你后面手动返回的 JSON。

### 4.2 n8n 的最小正确链路

当前这类同步工作流，最关键的是最后必须走到 `Respond to Webhook`。

可用结构：

1. `Webhook`
2. `Code` 取出 `prompt`
3. 创建 KIE 任务
4. 轮询查询任务结果
5. 提取最终图片 URL
6. `Respond to Webhook`

### 4.3 读取 prompt 的写法

在 `Code` 节点里可这样写：

```js
const prompt = $json.body?.prompt ?? '';
return [{ json: { prompt } }];
```

### 4.4 Respond 节点必须返回什么

中台最稳的兼容格式是：

```json
{
  "success": true,
  "image_urls": ["https://xxx.png"],
  "image_url": "https://xxx.png",
  "file_name": "xxx.png"
}
```

`Respond` 节点建议直接写：

```js
={{ {
  success: true,
  image_urls: $json.url ? [$json.url] : [],
  image_url: $json.url || '',
  file_name: $json.name || ''
} }}
```

只要最终响应里有真实图片 URL，中台就能提取并写回。

### 4.5 当前 n8n 已验证可用的最终输出字段

你当前 `Respond` 前一跳已经能拿到：

- `url`
- `name`

例如：

```json
{
  "url": "https://tempfile.aiquickdraw.com/zimage/1774720019414-hst97dcyqrc.png",
  "name": "222fe9e01701a287b05d3a01368f6e6c.png"
}
```

这时直接 `Respond` 即可，不需要中间再做复杂转换。

## 5. 手动接线时最容易出错的地方

### 5.1 Respond 节点接到错误分支

如果 `Respond` 接在错误输出分支，而不是成功主分支：

- n8n 面板里可能看起来“有输出”
- 但真正成功请求不会走到它
- 外部调用方会一直超时

正确做法：

- `Respond` 必须在成功主链路上

### 5.2 正式 webhook 和 webhook-test 混用

要区分两个地址：

- 测试地址：`/webhook-test/...`
- 正式地址：`/webhook/...`

中台当前只调用正式地址：

`https://n8n.deepsix.store/webhook/simple-prompt`

如果你只在测试模式里验证成功，而正式工作流没激活或没更新，线上还是会失败。

### 5.3 中台等待时间太短

这条链路是同步等生图完成再返回。

如果中台等待时间过短，会出现：

- n8n 最后其实成功了
- 但中台先超时了
- 前端看到失败

当前已经把超时调到：

`WF_002_WEBHOOK_TIMEOUT_MS=90000`

## 6. 纯手动排查顺序

建议按下面顺序排查：

1. 直接测 n8n webhook

```bash
curl -ksS --max-time 120 \
  -X POST 'https://n8n.deepsix.store/webhook/simple-prompt' \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"测试提示词"}'
```

如果这里不返回，就先别看前端和中台。

2. 再测中台接口

```bash
curl -ksS --max-time 120 \
  -X POST 'http://127.0.0.1:3002/api/v1/workflows/WF-002/webhook-execute' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer 你的token' \
  -d '{"prompt":"测试提示词"}'
```

3. 最后再测前端页面

打开：

`https://gzl.wikigood.top/portal/wf002.html?token=你的token`

## 7. 当前验证通过的结果

当前已验证成功的中台返回特征：

- `upstream_status = 200`
- `status = success`
- `image_urls` 有值

示例图片地址：

`https://tempfile.aiquickdraw.com/zimage/1774720019414-hst97dcyqrc.png`

这说明当前三段链路已经通了：

- 前端 -> 中台
- 中台 -> n8n
- n8n -> 中台响应

## 8. 后续建议

当前 `WF_002` 是同步等待生图完成再返回，能用，但有两个现实限制：

- 用户需要等待几十秒
- 如果生图时间继续变长，还可能再次接近超时窗口

后续如果要更稳，建议升级为异步模式：

1. 前端提交后先拿到 `accepted`
2. n8n 后台慢慢跑
3. 完成后回写中台
4. 前端轮询中台 run 状态展示最终结果

这不是当前必须做的事，但这是更稳定的长期方案。
