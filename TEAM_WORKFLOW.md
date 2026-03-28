# 团队协作流程

## 目标

这份文档用于统一 AI 工作流积分系统的团队开发、联调、评审和部署流程，避免多人协作时出现环境不一致、覆盖他人改动、部署混乱等问题。

## 推荐角色分工

一个人可以兼任多个角色，但职责要尽量清晰：

- 后端负责人：`ai-mid-platform/`
- 前端负责人：`client-portal/`、`demo/`
- 工作流负责人：`WF_001/`
- 部署负责人：`deploy/`、Docker、服务器发布

对于跨目录任务，建议明确一个主负责人。

## 标准开发流程

1. 拉取最新 `dev`
2. 创建自己的任务分支
3. 在本地完成开发
4. 用 Docker 启动并验证
5. 推送分支到远程
6. 提交 PR 到 `dev`
7. 指定相关负责人 review
8. review 通过后合并到 `dev`
9. 集成验证通过后再合并到 `main`

## 本地运行手册

### 启动服务

```powershell
docker compose --env-file .env.docker up -d --build
```

### 查看状态

```powershell
docker compose --env-file .env.docker ps
```

### 查看日志

```powershell
docker compose --env-file .env.docker logs -f app
docker compose --env-file .env.docker logs -f db
docker compose --env-file .env.docker logs -f web
```

### 停止服务

```powershell
docker compose --env-file .env.docker down
```

## 按改动范围的验证建议

### 如果改了 `demo/`

要验证：

- 落地页 `/` 能否正常打开
- 登录页 `/auth/` 能否正常打开
- 注册、登录流程是否正常
- 登录成功后是否会跳转到 `/portal/`

### 如果改了 `client-portal/`

要验证：

- 登录后能否进入积分页面
- token 是否能正常读取
- 积分数据是否正常展示
- 工作流列表、调用记录是否正常展示

### 如果改了 `ai-mid-platform/`

要验证：

- `/health/db`
- `/register`
- `/login`
- `/me`
- `/api/v1/workflows`
- `/api/v1/point-accounts/me`
- `/api/v1/workflow-runs/*`

### 如果改了 `WF_001/`

要验证：

- 工作流是否能正常启动
- 中台注册是否成功
- callback 是否成功
- 数据库记录是否正确更新

### 如果改了 `deploy/` 或 Docker 配置

要验证：

- 全量重建是否成功
- 容器是否都能正常启动
- 路由映射是否还正常
- 本地数据库是否仍然和生产环境隔离

## Code Review 检查清单

review 时建议至少确认：

- 改动范围是否清晰
- 有没有误改无关文件
- 本地 Docker 是否还能正常启动
- 新增环境变量是否已写入文档
- 是否说明了部署影响
- UI 改动是否附截图

## 发布流程建议

推荐发布步骤：

1. 先把功能合并进 `dev`
2. 在 `dev` 上做集成验证
3. 发起 `dev -> main` 的发布 PR
4. 检查部署说明
5. 从 `main` 部署

## 生产部署原则

如果服务器后续也全面切换到 Docker，建议固定使用：

```bash
git pull
docker compose up -d --build
```

如果生产环境暂时还使用旧的 `systemd + nginx` 方式，请保持部署责任集中，不要多人同时手工改服务器。

## 团队沟通原则

以下情况要主动同步给团队：

- 你正在修改共享配置文件
- 你要改接口路径或环境变量
- 你这次同时改了前端和后端
- 你准备发版或部署服务器

大多数协作问题不是技术问题，而是没有提前同步。

## 减少冲突的建议

- 分支尽量小
- 尽量频繁同步 `dev`
- 不要把多个无关需求混在一个分支里
- 改共享配置前先沟通
- 不要未经确认覆盖他人的工作

## 建议的团队节奏

可以参考这个简单节奏：

- 周前半段：开发功能、修 bug
- 周中：合并到 `dev`，做联调
- 周后半段：稳定 `dev`，准备发布

这不是硬性规定，但对多人协作会很有帮助。
