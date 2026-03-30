# 团队成员首次使用说明

这份文档用于帮助新加入项目的小组成员快速完成以下工作：

- 拉取代码
- 本地启动项目
- 验证项目是否运行正常
- 创建自己的开发分支
- 正确提交代码并发起协作

## 一、开始前需要准备什么

请先确保你的电脑已经安装并准备好以下内容：

- Git
- Docker Desktop
- 可以正常启动 Docker Engine

如果 Docker Desktop 没有正常启动，请先解决 Docker 环境问题，再继续后续步骤。

## 二、第一次拉取代码

在终端中执行：

```bash
git clone https://github.com/beyondband007-bot/ai-workflow.git
cd ai-workflow
git checkout dev
```

说明：

- `main` 是稳定分支
- `dev` 是团队日常协作分支
- 所有人默认都从 `dev` 开始工作

## 三、第一次准备环境变量

### 情况 1：仓库里已经有 `.env.docker`

如果仓库根目录里已经有 `.env.docker`，可以直接使用。

### 情况 2：仓库里没有 `.env.docker`

请从模板复制一份：

```powershell
copy .env.docker.example .env.docker
```

如果项目负责人要求修改某些变量，请按要求修改后再启动。

## 四、第一次启动项目

在项目根目录执行：

```powershell
docker compose --env-file .env.docker up -d --build
```

第一次启动通常会比较慢，因为需要：

- 拉取基础镜像
- 构建应用镜像
- 初始化本地数据库

## 五、检查项目是否启动成功

### 1. 查看容器状态

```powershell
docker compose --env-file .env.docker ps
```

正常情况下应看到以下服务处于运行状态：

- `ai-workflow-db`
- `ai-workflow-app`
- `ai-workflow-web`

### 2. 查看后端日志

```powershell
docker compose --env-file .env.docker logs -f app
```

### 3. 查看数据库日志

```powershell
docker compose --env-file .env.docker logs -f db
```

### 4. 打开页面验证

请在浏览器中访问：

- 落地页：`http://127.0.0.1:8080/`
- 登录页：`http://127.0.0.1:8080/auth/`
- 积分页：`http://127.0.0.1:8080/portal/`
- 健康检查：`http://127.0.0.1:3002/health/db`

如果健康检查返回数据库正常，说明本地环境已经可以使用。

## 六、数据库说明

每位成员本地启动 Docker 后，都会在自己的电脑上启动一套独立数据库。

默认情况下：

- 你本地连接的是你自己电脑上的 Docker MySQL
- 不会连接组长的数据库
- 不会连接其他成员的数据库
- 不会影响服务器数据库

本地数据库连接信息通常为：

- Host：`127.0.0.1`
- Port：`3307`
- Database：`auth_demo`
- User：`app_user`
- Password：见 `.env.docker`

## 七、开始开发前必须做的事

不要直接在 `dev` 分支上改代码。

请先创建自己的功能分支：

```bash
git checkout -b feature/你的功能名
```

例如：

```bash
git checkout -b feature/login-page-optimize
git checkout -b fix/workflow-callback-error
```

## 八、日常开发时的标准流程

### 1. 每天开始工作前先同步 `dev`

```bash
git checkout dev
git pull origin dev
```

### 2. 回到自己的分支继续开发

```bash
git checkout 你的分支名
```

如果 `dev` 有新内容，建议合并到自己的分支：

```bash
git merge dev
```

### 3. 本地开发完成后做基本验证

建议至少验证：

- 页面能打开
- 健康检查通过
- 你改到的功能正常

常用命令：

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
curl http://127.0.0.1:3002/health/db
```

## 九、提交代码时的注意事项

提交前请特别注意以下几点：

### 1. 不要直接提交到 `main`

所有功能开发、修复、重构都应：

- 先提交到自己的分支
- 再发起 PR 到 `dev`

### 2. 不要直接在 `dev` 上长期开发

`dev` 是团队集成分支，不是个人工作分支。

### 3. 不要提交本地依赖和缓存文件

这些文件不应该提交：

- `node_modules/`
- `.venv/`
- `__pycache__/`
- `*.log`
- 临时压缩包

### 4. 修改配置文件时要提前同步

如果你改了下面这些内容，请先和组内同步：

- `docker-compose.yml`
- `Dockerfile`
- `deploy/nginx/*.conf`
- `.env` 相关文件
- 接口地址
- 路由规则

### 5. 一个分支尽量只做一件事

不要把多个无关需求混在同一个分支里，否则 review 和合并都会很困难。

### 6. 改完前端最好附截图

如果你改了页面或交互，提交 PR 时最好附：

- 修改前截图
- 修改后截图

### 7. 改完接口最好写清测试方式

例如在 PR 描述里写清楚：

- 测了哪个接口
- 用什么方式测的
- 返回结果是否正常

## 十、正确的提交命令

### 1. 查看当前改动

```bash
git status
```

### 2. 添加改动到暂存区

如果你确认本次所有改动都要提交：

```bash
git add .
```

如果你只想提交某几个文件：

```bash
git add 文件路径
```

例如：

```bash
git add client-portal/app.js
git add ai-mid-platform/src/auth/auth.service.ts
```

### 3. 提交代码

```bash
git commit -m "feat: 这里写本次改动说明"
```

推荐提交信息格式：

- `feat:` 新功能
- `fix:` 修复问题
- `chore:` 配置、维护、非功能变更
- `docs:` 文档更新
- `refactor:` 重构
- `test:` 测试相关

示例：

```bash
git commit -m "feat: 增加登录后跳转积分页面"
git commit -m "fix: 修复工作流回调地址错误"
git commit -m "docs: 补充团队首次使用说明"
```

### 4. 推送到远程分支

第一次推送自己的分支：

```bash
git push -u origin 你的分支名
```

例如：

```bash
git push -u origin feature/login-page-optimize
```

后续再次推送同一分支：

```bash
git push
```

### 5. 发起 PR

推送成功后，去 GitHub：

- 打开仓库页面
- 选择你的分支
- 发起 Pull Request
- 目标分支选择 `dev`

## 十一、推荐的提交流程

建议每次都按下面流程操作：

```bash
git checkout dev
git pull origin dev
git checkout -b feature/你的功能名
```

开发完成后：

```bash
git status
git add .
git commit -m "feat: 你的改动说明"
git push -u origin feature/你的功能名
```

然后去 GitHub 发起 PR 到 `dev`。

## 十二、常用命令汇总

### 启动项目

```powershell
docker compose --env-file .env.docker up -d --build
```

### 停止项目

```powershell
docker compose --env-file .env.docker down
```

### 查看状态

```powershell
docker compose --env-file .env.docker ps
```

### 查看后端日志

```powershell
docker compose --env-file .env.docker logs -f app
```

### 查看数据库日志

```powershell
docker compose --env-file .env.docker logs -f db
```

### 查看前端日志

```powershell
docker compose --env-file .env.docker logs -f web
```

### 切换到开发分支

```bash
git checkout dev
```

### 新建功能分支

```bash
git checkout -b feature/你的功能名
```

### 同步开发分支

```bash
git checkout dev
git pull origin dev
```

### 提交并推送

```bash
git add .
git commit -m "feat: 你的改动说明"
git push -u origin 你的分支名
```

## 十三、遇到问题先检查什么

如果项目跑不起来，请先检查：

1. Docker Desktop 是否正常启动
2. `docker compose ps` 是否有容器运行
3. `.env.docker` 是否存在
4. `http://127.0.0.1:3002/health/db` 是否可访问
5. 是否误改了 `docker-compose.yml` 或环境变量

如果还是有问题，请把以下信息发给项目负责人或组内同学：

- `docker compose --env-file .env.docker ps`
- `docker compose --env-file .env.docker logs --tail 100 app`
- `docker compose --env-file .env.docker logs --tail 100 db`

这样别人更容易帮你定位问题。
