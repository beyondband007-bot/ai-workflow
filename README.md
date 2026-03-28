# AI-WORKFLOW

这是团队协作使用的 AI 积分系统与工作流项目仓库。

当前仓库包含：

- `ai-mid-platform/`：NestJS 中台与积分后端
- `client-portal/`：积分页面
- `demo/`：落地页与登录页资源
- `WF_001/`：Python 工作流脚本
- `deploy/`：Docker、Nginx、部署配置

## 团队拉取后如何本地运行

### 1. 克隆仓库

```bash
git clone <your-repo-url>
cd ai-workflow
```

### 2. 准备环境变量

如果仓库里已经有 `.env.docker`，可以直接使用。

如果没有，就从模板复制：

```powershell
copy .env.docker.example .env.docker
```

### 3. 启动 Docker 环境

```powershell
docker compose --env-file .env.docker up -d --build
```

### 4. 检查容器状态

```powershell
docker compose --env-file .env.docker ps
```

### 5. 访问页面

- 落地页：`http://127.0.0.1:8080/`
- 登录页：`http://127.0.0.1:8080/auth/`
- 积分页：`http://127.0.0.1:8080/portal/`
- 后端接口：`http://127.0.0.1:3002/`
- 数据库健康检查：`http://127.0.0.1:3002/health/db`

## 本地数据库连接

本地 Docker MySQL 连接信息：

- Host：`127.0.0.1`
- Port：`3307`
- Database：`auth_demo`
- User：`app_user`
- Password：`RootDemo123!`

说明：

- 本地 Docker 使用的是本机容器数据库
- 默认不会连接服务器数据库
- 本地测试不会影响服务器数据，除非有人手动修改环境变量去连接远程库

## 必须提交到 Git 的文件

为了保证团队成员拉下来后能跑通，以下内容必须提交：

- `docker-compose.yml`
- `ai-mid-platform/Dockerfile`
- `deploy/nginx/ai-workflow.docker.conf`
- `.env.docker.example`
- 源代码目录：
  - `ai-mid-platform/`
  - `client-portal/`
  - `demo/`
  - `WF_001/`
  - `deploy/`
- 文档：
  - `README.md`
  - `CONTRIBUTING.md`
  - `TEAM_WORKFLOW.md`

## 不应该提交到 Git 的内容

这些文件应由每位开发者本地生成，不应该提交：

- `node_modules/`
- `.venv/`
- `__pycache__/`
- `dist/`
- `coverage/`
- `*.log`
- `*.zip`
- `demo/.git/`

## 常用命令

启动：

```powershell
docker compose --env-file .env.docker up -d --build
```

查看状态：

```powershell
docker compose --env-file .env.docker ps
```

查看后端日志：

```powershell
docker compose --env-file .env.docker logs -f app
```

查看数据库日志：

```powershell
docker compose --env-file .env.docker logs -f db
```

查看前端日志：

```powershell
docker compose --env-file .env.docker logs -f web
```

停止服务：

```powershell
docker compose --env-file .env.docker down
```

## 协作文档

详细协作规范见：

- [CONTRIBUTING.md](/d:/ai-workflow/CONTRIBUTING.md)
- [TEAM_WORKFLOW.md](/d:/ai-workflow/TEAM_WORKFLOW.md)
