# Server README

服务器部署目录：

- `/home/zzq/workspace/ai-workflow-dev`

主站与服务：

- `gzl.wikigood.top` -> Docker `web/app/db`
- `mycar.deepsix.store` -> `wf003-car-export.service`

更新 `dev` 分支：

```bash
cd /home/zzq/workspace/ai-workflow-dev
./deploy/server-local/update-dev.sh
```

常用检查：

```bash
docker compose \
  --env-file .env.docker \
  --env-file deploy/server-local/.env.docker.server \
  -f docker-compose.yml \
  -f deploy/server-local/docker-compose.server.yml \
  ps

systemctl status wf003-car-export.service

curl -ksS https://gzl.wikigood.top/health/db
curl -ksS https://mycar.deepsix.store/ | head
```

服务器本地配置文件：

- `deploy/server-local/.env.docker.server`
- `deploy/server-local/docker-compose.server.yml`
- `deploy/server-local/wf003.env`
- `deploy/server-local/wf003-car-export.service`

当前服务器上 `wf003-car-export.service` 的实际配置来源：

- systemd 单元文件：`/etc/systemd/system/wf003-car-export.service`
- 环境文件：`deploy/server-local/wf003.env`

`WF-003` 必填环境变量：

- `PORT`
- `WF_003_MIDDLE_PLATFORM_URL` 或 `WORKFLOW_API_BASE` + `WORKFLOW_SUBMIT_PATH`
- `KIE_UPLOAD_URL`
- `KIE_API_KEY`

不要直接覆盖这些本地文件。
