from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from .config import get_settings
from .feishu_client import FeishuClient
from .kie_client import KieClient
from .middle_platform_client import MiddlePlatformClient
from .repositories import TaskRepository
from .workflow import (
    WorkflowInputError,
    build_feishu_upload_items,
    build_kie_payload,
    build_middle_platform_payload,
    build_task_items,
    collect_attachments,
    normalize_submission,
    parse_kie_callback,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    poll_task = None
    if settings.poll_enabled:
        poll_task = asyncio.create_task(_poll_kie_records_loop())
    try:
        yield
    finally:
        if poll_task:
            poll_task.cancel()
            try:
                await poll_task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="WF-003 Worker", version="1.0.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/webhook/wf003-kie-submit")
async def submit(request: Request) -> dict[str, Any]:
    body = await _json_body(request)
    settings = get_settings()
    repository = TaskRepository(settings)
    kie_client = KieClient(settings)

    try:
        submission = normalize_submission(body, settings)
        repository.create_submission(submission)
        tasks = build_task_items(submission)
        for task in tasks:
            task_id = await kie_client.create_task(build_kie_payload(task, settings))
            repository.register_task(task, task_id)
    except WorkflowInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    return {
        "ok": True,
        "message": "Tasks submitted to Kie. Waiting for callbacks.",
        "submissionId": submission.submission_id,
        "expectedTasks": submission.expected_tasks,
        "exteriorCount": len(submission.exterior_images),
        "interiorCount": len(submission.interior_images),
    }


@app.post("/webhook/wf003-kie-callback")
async def kie_callback(request: Request) -> dict[str, Any]:
    body = await _json_body(request)
    settings = get_settings()
    repository = TaskRepository(settings)

    try:
        callback = parse_kie_callback(body)
        update = repository.update_callback(callback)
    except WorkflowInputError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=str(error)) from error

    if not update.get("shouldFinalize"):
        return {
            "ok": True,
            "accepted": True,
            "finalized": False,
            "submissionId": update.get("submissionId"),
            "taskId": update.get("taskId"),
            "state": update.get("state"),
            "resolvedCount": update.get("resolvedCount", 0),
            "expectedTasks": update.get("expectedTasks", 0),
            "message": (
                "callback accepted but task was not found in staticData"
                if update.get("reason") == "task_not_found"
                else "callback accepted, waiting for remaining tasks"
            ),
        }

    return await _finalize_submission(repository, update["submissionId"], settings)


@app.post("/internal/wf003-poll-kie")
async def poll_kie_once() -> dict[str, Any]:
    settings = get_settings()
    repository = TaskRepository(settings)
    return await _poll_kie_records_once(repository, settings)


async def _finalize_submission(
    repository: TaskRepository,
    submission_id: str,
    settings,
) -> dict[str, Any]:
    final_assets = repository.build_final_assets(submission_id)
    if final_assets.get("skipFinalize"):
        return {
            "ok": True,
            "accepted": True,
            "finalized": False,
            "submissionId": submission_id,
            "message": final_assets.get("reason", "finalize skipped"),
        }

    middle_platform_response: dict[str, Any] | None = None
    upload_summary: dict[str, Any] = {
        "uploadSuccessCount": 0,
        "uploadFailedCount": 0,
        "uploadFailures": [],
    }
    record_response: dict[str, Any] | None = None

    try:
        middle_platform_response = await MiddlePlatformClient(settings).notify(
            final_assets["callback_url"],
            final_assets["callback_token"],
            build_middle_platform_payload(final_assets),
        )
    except Exception as error:
        repository.mark_finalize_failed(submission_id, str(error))
        raise HTTPException(status_code=502, detail=f"Notify middle platform failed: {error}") from error

    try:
        upload_items = build_feishu_upload_items(final_assets)
        feishu_client = FeishuClient(settings)
        upload_results = []
        for item in upload_items:
            upload_results.append(await feishu_client.upload_by_url(item))
        upload_summary = collect_attachments(upload_results)
        if upload_results:
            record_response = await feishu_client.create_bitable_record(
                upload_summary,
                final_assets.get("car_name") or "",
            )
    except Exception as error:  # noqa: BLE001 - Feishu must not block settlement callback
        repository.mark_finalize_failed(submission_id, f"Feishu finalize failed: {error}")
        upload_summary = {
            **upload_summary,
            "uploadFailedCount": max(1, int(upload_summary.get("uploadFailedCount") or 0)),
            "uploadFailures": [
                *(upload_summary.get("uploadFailures") or []),
                {"error": str(error)},
            ],
        }
        raise HTTPException(status_code=502, detail=f"Feishu finalize failed: {error}") from error

    repository.mark_finalized(submission_id)
    await asyncio.sleep(0)
    return {
        "ok": True,
        "accepted": True,
        "finalized": True,
        "submissionId": submission_id,
        "totalExterior": final_assets["totalExterior"],
        "totalInterior": final_assets["totalInterior"],
        "successCount": final_assets["successCount"],
        "failedCount": final_assets["failedCount"],
        "failedTasks": final_assets["failedTasks"],
        "uploadSuccessCount": upload_summary.get("uploadSuccessCount", 0),
        "uploadFailedCount": upload_summary.get("uploadFailedCount", 0),
        "uploadFailures": upload_summary.get("uploadFailures", []),
        "middlePlatformResponse": middle_platform_response,
        "recordResponse": record_response,
    }


async def _poll_kie_records_loop() -> None:
    while True:
        settings = get_settings()
        repository = TaskRepository(settings)
        try:
            await _poll_kie_records_once(repository, settings)
        except Exception:
            # Polling is a callback fallback; do not crash the API server if Kie is temporarily unavailable.
            pass
        await asyncio.sleep(settings.poll_interval_seconds)


async def _poll_kie_records_once(repository: TaskRepository, settings) -> dict[str, Any]:
    kie_client = KieClient(settings)
    tasks = repository.list_unresolved_tasks(settings.poll_batch_size)
    checked = 0
    updated = 0
    finalized = 0
    skipped = 0
    errors: list[dict[str, str]] = []

    for task in tasks:
        task_id = str(task.get("task_id") or "")
        if not task_id:
            skipped += 1
            continue
        checked += 1
        try:
            record = await kie_client.get_task_record(task_id)
            state = str(record.get("state") or "").strip().lower()
            if state not in {"success", "failed", "fail", "error"} and not record.get("resultJson"):
                skipped += 1
                continue
            callback = parse_kie_callback({"data": record})
            update = repository.update_callback(callback)
            updated += 1
            if update.get("shouldFinalize"):
                await _finalize_submission(repository, update["submissionId"], settings)
                finalized += 1
        except Exception as error:  # noqa: BLE001 - keep polling other tasks
            errors.append({"taskId": task_id, "error": str(error)})

    return {
        "ok": True,
        "checked": checked,
        "updated": updated,
        "finalized": finalized,
        "skipped": skipped,
        "errors": errors,
    }


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid JSON body") from error
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="JSON body must be an object")
    return body
