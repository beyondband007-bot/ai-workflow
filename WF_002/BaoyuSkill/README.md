# 宝玉生图工作台

这是 `baoyu-image-gen` 的本地 Web 工作台版本，包含 React 前端、Fastify 后端、MySQL 8、Prisma 和 Docker Compose。

页面面向普通用户，只展示创作向导和作品结果。香蕉 2 的 API Key 保存在 `.env`，不会出现在前端界面里。最终发送给模型的高质量 prompt 由系统在后台组合，用户端不可见、不可编辑、不可复制。

## 当前能力

- 使用创作向导生成单张图片。
- 选择作品类型、风格、布局、配色、画幅和清晰度。
- 填写主题、目标受众、核心信息、画面文字、使用场景和不想出现的内容。
- 根据内容给出智能建议，并支持一键应用建议。
- 固定调用香蕉 2，不在页面暴露其他 provider 或 API Key。
- 生成中展示状态，成功后可预览、下载和打开大图。
- MySQL 保存任务、状态、错误、图片路径和结构化作品参数。
- 历史记录可筛选、搜索、预览、删除，并能恢复新作品的创作参数。

## 本地启动

1. 复制环境变量示例：

```powershell
Copy-Item .env.example .env
```

2. 在 `.env` 中填写香蕉 2 的 API Key：

```env
KIE_API_KEY=你的_KIE_API_KEY
KIE_IMAGE_MODEL=nano-banana-2
```

3. 启动 Docker：

```powershell
docker compose up -d
```

首次启动时 API 容器会自动执行 Prisma migration，准备 MySQL 表结构。

## 访问地址

- Web 页面：http://127.0.0.1:5173
- API 健康检查：http://127.0.0.1:3003/api/health
- MySQL：localhost:3306

## 常用命令

```powershell
npm run typecheck
npm run build
npm run db:deploy
docker compose ps
docker compose logs -f api
docker compose logs -f web
```

## 数据保存

- 任务记录保存在 MySQL 的 `generation_jobs` 和 `generation_assets`。
- 结构化创作参数保存在 `generation_jobs.project_data`。
- 上传参考图保存在 `data/uploads`。
- 生成图片保存在 `data/images`。
- Docker MySQL 数据保存在 `mysql-data` volume。

## 手动验收

1. 打开 Web 页面。
2. 修改作品类型、风格、布局、配色、主题和画面文字。
3. 点击“应用建议”，确认推荐参数会写入表单。
4. 点击“生成图片”，等待状态从排队中、生成中进入已完成或失败。
5. 成功后预览图片并下载。
6. 刷新页面，确认历史记录仍存在。
7. 点击新生成的历史项，确认创作参数会恢复到左侧向导。
8. 确认页面没有 API Key、provider 列表、最终 prompt、prompt 编辑或 prompt 复制入口。

## 当前边界

- 只支持单图生成。
- 智能建议是本地规则引擎，不额外调用 LLM。
- 旧历史记录没有 `project_data`，只能显示基础任务信息；Module 11 之后生成的新作品可以恢复完整创作参数。
- 当前定位是本地自用工作台，暂未加入登录页和公网访问保护。
