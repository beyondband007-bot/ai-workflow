# WF_001

文件：

- [WF_001.py](/C:/Users/27256/Documents/Codex/积分系统/points system/workflows/WF_001/WF_001.py)

当前接入方式：

- 前台：`WF-001` 已通过中台工作流列表出现在首页
- 中台：脚本执行时会先调用 `POST /api/v1/workflow-runs/register`
- 工作流完成后会调用 `POST /api/v1/workflow-runs/callback`

脚本参数已经按 PRD 接口格式整理：

- `workflow_code`：固定为 `WF-001`
- `client_request_id`：可通过 `--client-request-id` 传入，不传则自动生成
- `request_payload_summary`：脚本自动组装，包含：
- `prompt_preview`
- `has_reference_image`
- `reference_image_path`
- `executor_type`
- `billing_mode`

回调时自动上送：

- `run_id`
- `workflow_code`
- `status`
- `finished_at`
- `result_summary`
- `result_urls`
- `external_task_id`
- `error_message`

PowerShell 运行：

```powershell
cd "C:\Users\27256\Documents\Codex\积分系统\points system\workflows\WF_001"
python .\WF_001.py
```

也可以显式传参：

```powershell
python .\WF_001.py `
  --user-id "suppertest" `
  --prompt "Generate a studio car image" `
  --image "C:\path\demo.png" `
  --client-request-id "wf001_test_001" `
  --poll-interval 5 `
  --timeout 300
```

默认中台地址：

```text
http://localhost:3000/api/v1
```

可通过环境变量覆盖：

```powershell
$env:MIDDLE_PLATFORM_BASE="http://your-host:3000/api/v1"
```

前台说明：

- 首页工作流卡片里的 `WF-001` 现在对应这个脚本
- 建议部署时把本目录一起上传，方便前台和中台对应同一套工作流说明
- 脚本默认按 `--user-id suppertest` 调中台，便于和登录页测试账号对齐
