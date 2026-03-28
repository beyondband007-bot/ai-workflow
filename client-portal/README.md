# Client Portal Prototype

这是“积分系统客户端前端原型”的静态页面，当前已按 [AI工作流积分与中台系统_PRD_v1.md](C:/Users/27256/Documents/Codex/积分系统/AI工作流积分与中台系统_PRD_v1.md) 重新核对参数、功能和示例数据。

## 本次对齐结论

### 1. 参数口径

- 积分锚点以 PRD v1 为准：`1 元人民币 = 100 积分`
- 原型中的工作流计费值已按新锚点修正：
  - `WF-001 = 10 积分 / 次`
  - `WF-002 = 100 积分 / 次`
  - `WF-003 = 30 积分 / 张`
- `WF-003` 预估和冻结规则已按 PRD 收敛：
  - `estimated_count` 上限 `7`
  - `estimated_frozen_points` 上限 `210`

### 2. 功能匹配

- 首页功能区与 PRD 一期范围一致：
  - 工作流入口
  - 积分账户总览
  - 调用记录
  - 积分流水
  - 结算规则
  - 参数映射区
- 原型定位仍是客户端首页，不包含：
  - 业务前端上传页
  - 后台管理页
  - 文件中转能力
  - 结果明细页

### 3. 数据匹配

- 工作流列表使用 PRD 定义字段：
  - `workflow_code`
  - `workflow_name`
  - `current_status`
  - `metering_mode`
  - `base_points`
  - `unit_points`
- 调用记录列表使用 PRD 定义字段：
  - `run_id`
  - `workflow_code`
  - `status`
  - `billing_status`
  - `estimated_frozen_points`
  - `final_charge_points`
  - `result_summary`
  - `finished_at`
- 积分流水使用 PRD 定义字段：
  - `ledger_no`
  - `ledger_type`
  - `change_points`
  - `run_id`
  - `workflow_code`
  - `remark`
  - `created_at`

## 当前原型文件

- 页面入口：[index.html](C:\Users\27256\Documents\Codex\积分系统\client-portal\client-portal\index.html)
- 页面脚本：[app.js](C:\Users\27256\Documents\Codex\积分系统\client-portal\client-portal\app.js)
- 页面样式：[styles.css](C:\Users\27256\Documents\Codex\积分系统\client-portal\client-portal\styles.css)

## 预览方式

直接用浏览器打开 [index.html](C:\Users\27256\Documents\Codex\积分系统\client-portal\client-portal\index.html)。

## 接口设计

接口统一挂在 `/api/v1`，返回结构统一为：

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_xxx",
  "data": {}
}
```

### 1. 工作流列表

`GET /api/v1/workflows`

用途：客户端首页展示工作流入口与计量信息。

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workflow_code` | string | 工作流编码 |
| `workflow_name` | string | 工作流名称 |
| `current_status` | string | `测试中` / `已运行` / `已上线` / `已暂停` |
| `metering_mode` | string | `fixed_points` / `result_count` |
| `base_points` | number \| null | 固定积分工作流单次积分 |
| `unit_points` | number \| null | 按结果计量工作流单张积分 |
| `description` | string | 工作流说明 |
| `max_estimated_count` | number | 最大预估数量 |
| `max_frozen_points` | number | 单次最大冻结积分 |

#### 返回示例

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_workflows_001",
  "data": [
    {
      "workflow_code": "WF-001",
      "workflow_name": "Python 单线程测试流",
      "current_status": "测试中",
      "metering_mode": "fixed_points",
      "base_points": 10,
      "unit_points": null,
      "description": "用于基础链路验证和能力展示。",
      "max_estimated_count": 1,
      "max_frozen_points": 10
    },
    {
      "workflow_code": "WF-003",
      "workflow_name": "n8n 图生图工作流",
      "current_status": "已运行",
      "metering_mode": "result_count",
      "base_points": null,
      "unit_points": 30,
      "description": "图生图按实际生成张数结算。",
      "max_estimated_count": 7,
      "max_frozen_points": 210
    }
  ]
}
```

### 2. 我的积分账户

`GET /api/v1/point-accounts/me`

用途：客户端首页和账户区展示余额、冻结、累计充值和累计消费。

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `user_id` | string | 当前用户标识 |
| `available_points` | number | 可用积分 |
| `frozen_points` | number | 冻结积分 |
| `total_recharged_points` | number | 累计入账积分 |
| `total_consumed_points` | number | 累计消费积分 |
| `today_runs` | number | 今日调用次数 |
| `today_spent_points` | number | 今日消耗积分 |
| `user_discount_rate` | number | 用户折扣 |
| `package_status` | string | 套餐状态展示值 |
| `last_manual_recharge_at` | string | 最近人工补积分时间 |

#### 返回示例

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_account_001",
  "data": {
    "user_id": "user_demo_001",
    "available_points": 62840,
    "frozen_points": 480,
    "total_recharged_points": 84200,
    "total_consumed_points": 21360,
    "today_runs": 19,
    "today_spent_points": 740,
    "user_discount_rate": 0.9,
    "package_status": "normal",
    "last_manual_recharge_at": "2026-03-24"
  }
}
```

### 3. 调用登记

`POST /api/v1/workflow-runs/register`

用途：业务前端调用前向中台登记，完成积分冻结并返回 `run_id`。

#### 请求字段

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `workflow_code` | 是 | string | 工作流编码 |
| `client_request_id` | 是 | string | 调用方幂等号 |
| `request_payload_summary` | 是 | object | 请求摘要，不传文件本体 |

#### `request_payload_summary` 示例

```json
{
  "car_series_name": "Model Y",
  "exterior_image_count": 5,
  "interior_image_count": 4
}
```

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 中台生成的运行单号 |
| `register_status` | string | `approved` / `rejected` |
| `estimated_count` | number | 预估结果数 |
| `estimated_frozen_points` | number | 预冻结积分 |

#### 返回示例

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_register_001",
  "data": {
    "run_id": "run_20260325_000001",
    "register_status": "approved",
    "estimated_count": 6,
    "estimated_frozen_points": 180
  }
}
```

### 4. 调用记录列表

`GET /api/v1/workflow-runs`

用途：客户端展示最近调用记录。

#### 查询参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `workflow_code` | string | 按工作流筛选 |
| `status` | string | 按执行状态筛选 |
| `page` | number | 页码 |
| `page_size` | number | 每页大小 |

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 运行单号 |
| `workflow_code` | string | 工作流编码 |
| `workflow_name` | string | 工作流名称 |
| `status` | string | `running` / `success` / `failed` |
| `billing_status` | string | `frozen` / `charged` / `rollback` |
| `estimated_frozen_points` | number | 预冻结积分 |
| `final_charge_points` | number | 最终扣费积分 |
| `started_at` | string | 开始时间 |
| `finished_at` | string | 结束时间 |
| `result_summary` | string | 结果摘要 |
| `result_summary_url` | string | 摘要结果地址 |

#### 返回示例

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_runs_001",
  "data": {
    "list": [
      {
        "run_id": "run_20260325_000001",
        "workflow_code": "WF-003",
        "workflow_name": "n8n 图生图工作流",
        "status": "success",
        "billing_status": "charged",
        "estimated_frozen_points": 180,
        "final_charge_points": 180,
        "started_at": "2026-03-25 21:31",
        "finished_at": "2026-03-25 21:36",
        "result_summary": "已回写 6 张结果图片链接",
        "result_summary_url": "https://example.com/result/run_20260325_000001"
      }
    ],
    "page": 1,
    "page_size": 20,
    "total": 1
  }
}
```

### 5. 调用记录详情

`GET /api/v1/workflow-runs/{run_id}`

用途：查看单个任务的结算结果概况。

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 运行单号 |
| `workflow_code` | string | 工作流编码 |
| `status` | string | 执行状态 |
| `billing_status` | string | 账务状态 |
| `estimated_count` | number \| null | 预估数量 |
| `actual_completed_count` | number \| null | 实际完成数量 |
| `estimated_frozen_points` | number | 预冻结积分 |
| `final_charge_points` | number | 最终扣费 |
| `refund_points` | number | 回滚积分 |
| `result_summary` | string | 结果摘要 |
| `result_summary_url` | string | 结果摘要地址 |

#### 说明

- 第一阶段详情接口不返回完整 `result_urls`
- `WF-003` 详情页只展示结算概况，不做结果明细接口

### 6. 结果回写

`POST /api/v1/workflow-runs/callback`

用途：工作流执行结束后主动回写中台，完成正式扣费或失败回滚。

#### 请求字段

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `run_id` | 是 | string | 运行单号 |
| `workflow_code` | 是 | string | 工作流编码 |
| `status` | 是 | string | `success` / `failed` / `timeout` / `cancelled` |
| `finished_at` | 是 | string | 结束时间 |
| `actual_completed_count` | 条件必填 | number | `WF-003` 必填 |
| `result_summary` | 否 | string | 结果摘要 |
| `result_urls` | 否 | string[] | 多结果地址 |
| `external_task_id` | 否 | string | 第三方任务号 |
| `error_message` | 否 | string | 错误信息 |

#### 请求示例

```json
{
  "run_id": "run_20260325_000001",
  "workflow_code": "WF-003",
  "status": "success",
  "finished_at": "2026-03-25 21:36:00",
  "actual_completed_count": 6,
  "result_summary": "已生成 6 张图片",
  "result_urls": [
    "https://example.com/result/1",
    "https://example.com/result/2"
  ],
  "external_task_id": "task_abc_001"
}
```

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `run_id` | string | 运行单号 |
| `status` | string | 回写后的执行状态 |
| `billing_status` | string | `charged` / `rollback` |
| `final_charge_points` | number | 最终扣费 |
| `refund_points` | number | 回滚积分 |

#### 返回示例

```json
{
  "code": 0,
  "message": "ok",
  "request_id": "req_callback_001",
  "data": {
    "run_id": "run_20260325_000001",
    "status": "success",
    "billing_status": "charged",
    "final_charge_points": 180,
    "refund_points": 0
  }
}
```

### 7. 积分流水

`GET /api/v1/point-ledgers`

用途：客户端展示账户积分流水。

#### 查询参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `ledger_type` | string | 按流水类型筛选 |
| `page` | number | 页码 |
| `page_size` | number | 每页大小 |

#### 返回字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `ledger_no` | string | 流水号 |
| `ledger_type` | string | `freeze` / `charge` / `rollback` / `manual_add` / `manual_deduct` |
| `change_points` | number | 积分变化，正负表示增减 |
| `run_id` | string | 关联运行单号 |
| `workflow_code` | string | 关联工作流编码 |
| `remark` | string | 流水说明 |
| `created_at` | string | 创建时间 |

### 8. 后台人工积分调整

`POST /api/v1/admin/point-adjustments`

用途：后台统一入口调整积分。

#### 请求字段

| 字段 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `user_id` | 是 | string | 用户标识 |
| `points` | 是 | number | 正负值区分加减 |
| `remark` | 是 | string | 调整原因 |
| `operator_id` | 是 | string | 操作人 |

#### 规则

- `points > 0`：流水语义记为 `manual_add`
- `points < 0`：流水语义记为 `manual_deduct`

## PRD 对齐备注

当前原型按 PRD v1 做了以下收敛：

- 不再使用旧版 `WF-001 = 1`、`WF-002 = 10`、`WF-003 = 3`
- 调用记录列表口径使用 `result_summary_url`，不再写旧版 `result_url`
- 失败账务状态统一展示为 `rollback`
- 流水类型使用 `charge`、`rollback`、`manual_add` 等语义值
- `WF-003` 详情接口第一阶段不返回完整结果图明细

## 后续接入建议

- 直接以 [app.js](C:\Users\27256\Documents\Codex\积分系统\client-portal\client-portal\app.js) 当前 mock 结构作为前端 TypeScript/JS 数据模型基线
- 若后续接 React/Vue，建议先抽出：
  - `workflow-list`
  - `point-account-summary`
  - `workflow-run-list`
  - `point-ledger-list`
  - `api-contract-panel`
- 如果你下一步要继续做，我可以直接把这份 README 再扩成“前端接口对接清单 + mock JSON 文件”版本
