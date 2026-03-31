# 部署与数据库迁移说明

## 当前推荐架构

- `ai-mid-platform/`：唯一后端服务，负责注册、登录、JWT、积分中台、工作流执行和回调结算。
- `client-portal/`：静态前端原型。
- `WF_001/`：Python 工作流脚本，由中台进程调用。
- MySQL：独立部署。

`demo/` 现在可以视为历史样例，不再是必需组件。

## 数据库迁移

### 1. 在旧机器导出

如果你本地 MySQL 数据库名是 `auth_demo`：

```bash
mysqldump -u root -p \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --routines \
  --triggers \
  auth_demo > auth_demo_20260327.sql
```

### 2. 在新服务器创建基础库表

如果你要先建空库，再导入结构：

```bash
mysql -u root -p < deploy/mysql-init.sql
```

### 3. 在新服务器导入数据

```bash
mysql -u root -p auth_demo < auth_demo_20260327.sql
```

### 4. 迁移后核对

重点检查：

- `users`
- `point_accounts`
- `points_transactions`
- `workflow_runs`
- `api_call_logs`

可以执行：

```sql
USE auth_demo;
SHOW TABLES;
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM point_accounts;
SELECT COUNT(*) FROM workflow_runs;
```

## 服务器目录建议

建议目录：

```text
/srv/ai-workflow/
├── ai-mid-platform/
├── client-portal/
├── WF_001/
└── deploy/
```

## 环境变量

### `ai-mid-platform/.env`

```env
PORT=3001
DATABASE_HOST=127.0.0.1
DATABASE_PORT=3306
DATABASE_USERNAME=app_user
DATABASE_PASSWORD=StrongPassword
DATABASE_NAME=auth_demo
JWT_SECRET=replace-with-a-long-random-secret
CALLBACK_SIGNING_SECRET=replace-with-another-long-random-secret
CALLBACK_SIGNING_TOLERANCE_SECONDS=300
PYTHON_EXECUTABLE=/usr/bin/python3
WF_001_SCRIPT_PATH=/srv/ai-workflow/WF_001/WF_001.py
WF_001_MOCK_MODE=off
```

如果 `WF_001` 不由中台本机触发，而是由其他脚本或工作机调用 `callback`，这些调用方也必须配置同一个 `CALLBACK_SIGNING_SECRET`。

## 服务部署

### 1. 安装运行时

```bash
sudo apt update
sudo apt install -y nginx mysql-client python3 python3-venv python3-pip curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. 安装后端依赖并构建

```bash
cd /srv/ai-workflow/ai-mid-platform
npm install
npm run build
```

### 3. 手工验证后端启动

```bash
cd /srv/ai-workflow/ai-mid-platform
npm run start:prod
```

### 4. 安装 `systemd` 服务

仓库里已有样板文件：[deploy/systemd/ai-mid-platform.service](/home/zzq/workspace/ai-workflow/deploy/systemd/ai-mid-platform.service)

```bash
sudo cp /srv/ai-workflow/deploy/systemd/ai-mid-platform.service /etc/systemd/system/ai-mid-platform.service
sudo systemctl daemon-reload
sudo systemctl enable ai-mid-platform
sudo systemctl start ai-mid-platform
sudo systemctl status ai-mid-platform
```

### 4.1 安装 `WF-003` 前端服务

`mycar.deepsix.store` 对应的是 `WF-003/car-export-portal/server.js`。如果要正式接入积分中台，必须部署这个服务的最新代码，并配置：

```bash
sudo cp /srv/ai-workflow/deploy/systemd/wf003-car-export.service /etc/systemd/system/wf003-car-export.service
sudo systemctl daemon-reload
sudo systemctl enable wf003-car-export
sudo systemctl restart wf003-car-export
sudo systemctl status wf003-car-export
```

关键环境变量：

```env
PORT=3001
WF_003_MIDDLE_PLATFORM_URL=http://127.0.0.1:3002/api/v1/workflows/WF-003/upload-execute
```

推荐直接复制模板：

```bash
cp /srv/ai-workflow/WF-003/car-export-portal/.env.production.example /srv/ai-workflow/WF-003/car-export-portal/.env.production
```

说明：

- `WF-003` 页面提交后不再直接走旧 n8n webhook
- 必须从积分门户进入，页面会携带登录 token
- `car-export-portal` 服务收到 token 后，会转发到积分中台执行冻结和结算

### 4.2 中台补充 `WF-003` 环境变量

推荐直接复制模板：

```bash
cp /srv/ai-workflow/ai-mid-platform/.env.wf003.example /srv/ai-workflow/ai-mid-platform/.env
```

`WF-003` 相关关键项：

```env
WF_003_WEBHOOK_URL=https://n8n.deepsix.store/webhook/bda7b6ac-10b6-4467-b6fd-83dd68c0bbd9
WF_003_CALLBACK_BASE_URL=https://你的中台公网域名
MIDDLE_PLATFORM_PUBLIC_BASE_URL=https://你的中台公网域名
```

这样中台在触发 `WF-003` 时会：

- 先登记 `workflow_runs` 并冻结积分
- 把 `run_id/client_request_id/callback_url` 一起发给上游工作流
- 等待工作流完成后，由上游回调中台结算

### 4.3 一键部署脚本

仓库里提供了脚本：

```bash
bash /srv/ai-workflow/deploy/scripts/deploy-wf003.sh
```

### 5. 部署静态前端和 Nginx

仓库里已有样板文件：[deploy/nginx/ai-workflow.conf](/home/zzq/workspace/ai-workflow/deploy/nginx/ai-workflow.conf)

```bash
sudo cp /srv/ai-workflow/deploy/nginx/ai-workflow.conf /etc/nginx/sites-available/ai-workflow.conf
sudo ln -sf /etc/nginx/sites-available/ai-workflow.conf /etc/nginx/sites-enabled/ai-workflow.conf
sudo nginx -t
sudo systemctl reload nginx
```

如果前端里现在写死了本地地址，需要把接口地址改成服务器域名下的 `/login`、`/register`、`/me`、`/api/...`。

## 上线后验证

### 基础健康检查

```bash
curl http://127.0.0.1:3001/
curl http://127.0.0.1:3001/health/db
```

### 注册和登录验证

```bash
curl -X POST http://127.0.0.1:3001/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","username":"admin","password":"123456"}'

curl -X POST http://127.0.0.1:3001/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"123456"}'
```

### JWT 联通验证

1. 调用 `POST /login` 获取 token。
2. 用该 token 调用 `GET /api/v1/workflows`。
3. 再调用 `GET /me` 和 `GET /api/v1/point-accounts/me`。

如果第 2 步返回 401，优先检查 `JWT_SECRET` 是否已正确加载，并确认请求头中带了 `Bearer token`。

### 回调签名验证

如果你开启了 `CALLBACK_SIGNING_SECRET`，未带签名的 `POST /api/v1/workflow-runs/callback` 应返回 401。

## 生产环境建议

- 不要继续使用 `root` 账号连业务库，单独创建 `app_user`。
- 把 MySQL、NestJS、Nginx 都设为开机自启。
- 开启数据库自动备份，至少每天一次。
- 把 `.env` 中当前明文演示密码和演示密钥全部替换。
- `WF_001` 脚本所需的第三方 API 密钥不要写死在代码里，建议改到环境变量。
