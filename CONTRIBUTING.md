# 协作贡献指南

## 适用范围

当前仓库包含这几部分内容：

- `ai-mid-platform/`：NestJS 中台与积分后端
- `client-portal/`：积分系统前端页面
- `demo/`：落地页与登录页相关资源
- `WF_001/`：Python 工作流脚本
- `deploy/`：Docker、Nginx、部署配置

这是一个多人协作、可部署的项目，提交代码时请默认按“团队共享生产代码库”的标准处理。

## 分支策略

建议统一使用以下分支模型：

- `main`：稳定、可部署分支
- `dev`：日常集成分支
- 功能分支：每个任务独立一个短期分支

推荐命名方式：

- `feature/功能名`
- `fix/问题名`
- `chore/维护项`
- `docs/文档名`

例如：

- `feature/login-redirect`
- `fix/docker-nginx-route`
- `docs/team-workflow`

## 日常开发流程

1. 先同步最新的 `dev`
2. 从 `dev` 拉出自己的任务分支
3. 只处理一个明确任务
4. 本地用 Docker 验证通过后再提交
5. 提交 PR / 合并请求到 `dev`
6. `dev` 验证完成后再合并到 `main`

除非是紧急修复，否则不要直接改 `main`。

## 本地开发统一标准

团队成员本地统一使用 Docker 运行，尽量保证环境一致。

启动命令：

```powershell
docker compose --env-file .env.docker up -d --build
```

常用检查命令：

```powershell
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f app
docker compose --env-file .env.docker logs -f db
docker compose --env-file .env.docker logs -f web
```

本地主要访问地址：

- 落地页：`http://127.0.0.1:8080/`
- 登录页：`http://127.0.0.1:8080/auth/`
- 积分页：`http://127.0.0.1:8080/portal/`
- 后端接口：`http://127.0.0.1:3002/`
- 数据库健康检查：`http://127.0.0.1:3002/health/db`

## 目录责任建议

为了减少冲突，建议按目录分工：

- `ai-mid-platform/`：后端接口、认证、积分、工作流编排
- `client-portal/`：积分系统前端展示与接口调用
- `demo/`：落地页、登录流程、静态资源
- `WF_001/`：工作流执行脚本与回调逻辑
- `deploy/`：Docker、Nginx、部署配置

如果一个任务跨多个目录，请在 PR 描述里写清楚影响范围。

## 提交信息规范

建议统一使用简单的提交前缀：

- `feat:` 新功能
- `fix:` 修复问题
- `chore:` 配置、工具、维护
- `docs:` 文档更新
- `refactor:` 重构但不改业务行为
- `test:` 测试相关

示例：

- `feat: 增加登录后跳转积分页面`
- `fix: 修复 nginx 登录页路由`
- `chore: 对齐 docker 运行时版本`

## PR 要求

每个 PR 至少说明：

- 改了什么
- 为什么改
- 影响了哪些目录
- 本地如何验证
- 如果改了页面，附上截图

尽量保持 PR 小而清晰。小 PR 更容易 review，也更不容易引入问题。

## 合并前最少验证项

合并到 `dev` 前，至少确认：

```powershell
docker compose --env-file .env.docker ps
curl http://127.0.0.1:3002/health/db
```

如果改了前端或登录流程，还要验证：

- `/`
- `/auth/`
- `/portal/`

如果改了后端，还要验证：

- 注册
- 登录
- `/me`
- 积分页会调用到的接口

如果改了工作流逻辑，还要验证：

- 工作流注册
- callback 回写
- 数据库记录是否正确写入

## 环境变量与配置文件

仓库里可能会包含本地和 Docker 环境配置文件。修改这些文件前，请先和团队同步。

推荐原则：

- 可复用模板放 Git
- 生产环境真实密钥只放服务器
- 每增加一个环境变量，都要同步更新部署文档

如果你修改了以下文件，务必在 PR 中单独说明：

- `docker-compose.yml`
- `ai-mid-platform/Dockerfile`
- `deploy/nginx/*.conf`
- 任意 `.env` 模板

## 部署安全原则

不要通过手工覆盖零散文件的方式部署服务器。

如果后续服务器也切到 Docker，推荐统一使用：

```bash
git pull
docker compose up -d --build
```

如果服务器暂时仍使用旧的 `systemd + nginx` 方式，请只由指定负责人部署。

## 冲突处理

如果你的分支落后了：

1. 先同步最新 `dev`
2. 把 `dev` 合并或 rebase 到自己的分支
3. 本地解决冲突
4. 重新执行 Docker 验证

不要在没看懂影响范围的情况下直接删除他人的改动。

## 文档更新要求

如果你新增或修改了以下内容，请在同一个 PR 里更新文档：

- 新服务
- 新环境变量
- 新接口路径
- 新部署步骤
- 本地启动方式变化

文档是交付内容的一部分，不是后补项。
