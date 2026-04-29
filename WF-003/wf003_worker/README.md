# WF-003 Worker

Python service that replaces the WF-003 n8n workflow.

## Endpoints

- `POST /webhook/wf003-kie-submit`: accepts the same JSON body that n8n received from the middle platform.
- `POST /webhook/wf003-kie-callback`: receives Kie task callbacks.
- `GET /health`: simple health check.

## Required Runtime Configuration

- `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- `KIE_API_KEY`
- `WF003_PUBLIC_BASE_URL` or `WF003_KIE_CALLBACK_URL`
- `WF_003_CALLBACK_TOKEN`
- `FEISHU_APP_ID`, `FEISHU_APP_SECRET`

`WF003_KIE_CALLBACK_URL` must be reachable by Kie. If it is not set, the worker uses:

```text
${WF003_PUBLIC_BASE_URL}/webhook/wf003-kie-callback
```

## Local Checks

```bash
PYTHONPATH=WF-003 python -m pytest WF-003/wf003_worker/tests -q
PYTHONPATH=WF-003 python -c "import wf003_worker.app"
```
