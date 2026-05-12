from __future__ import annotations

from datetime import datetime, timezone
import json
import random
import string
from typing import Any

from .config import Settings
from .models import (
    EXTERIOR_PROMPT,
    INTERIOR_PROMPT,
    NormalizedSubmission,
    ParsedKieCallback,
    TaskItem,
)


class WorkflowInputError(ValueError):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def format_finished_at() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def build_interior_groups(images: list[str]) -> list[list[str]]:
    if not images:
        return []
    if len(images) <= 3:
        return [images]
    if len(images) == 4:
        return [images[:2], images[2:4]]
    return [images[:3], images[3:5]]


def normalize_submission(body: dict[str, Any], settings: Settings) -> NormalizedSubmission:
    source_body = body.get("body") if isinstance(body.get("body"), dict) else body
    car_name = str(source_body.get("car_name") or "").strip()
    exterior = [
        str(item).strip()
        for item in source_body.get("exterior_images", [])
        if str(item or "").strip()
    ]
    interior = [
        str(item).strip()
        for item in source_body.get("interior_images", [])
        if str(item or "").strip()
    ]
    feishu_app_id = str(source_body.get("feishu_app_id") or "").strip()
    feishu_id = str(source_body.get("feishu_id") or "").strip()

    if not car_name:
        raise WorkflowInputError("car_name is required")
    if not exterior:
        raise WorkflowInputError("exterior_images is required")
    if not feishu_app_id:
        raise WorkflowInputError("feishu_app_id is required")
    if not feishu_id:
        raise WorkflowInputError("feishu_id is required")

    run_id = str(source_body.get("run_id") or "").strip()
    submission_id = run_id or _make_submission_id()
    callback_url = str(source_body.get("callback_url") or "").strip()
    if not callback_url:
        raise WorkflowInputError("callback_url is required")

    callback_token = str(source_body.get("callback_token") or "").strip()
    if not callback_token:
        callback_token = settings.wf003_callback_token

    interior_groups = build_interior_groups(interior)
    return NormalizedSubmission(
        submission_id=submission_id,
        run_id=run_id or submission_id,
        workflow_code=str(source_body.get("workflow_code") or "WF-003").strip() or "WF-003",
        client_request_id=str(source_body.get("client_request_id") or "").strip(),
        callback_url=callback_url,
        callback_token=callback_token,
        car_name=car_name,
        logo=str(source_body.get("logo") or "").strip(),
        source=str(source_body.get("source") or "").strip(),
        submitted_at=str(source_body.get("submitted_at") or utc_now_iso()).strip(),
        user_id=str(source_body.get("user_id") or "").strip(),
        feishu_app_id=feishu_app_id,
        feishu_id=feishu_id,
        exterior_images=exterior,
        interior_images=interior,
        interior_groups=interior_groups,
        expected_tasks=len(exterior) + len(interior_groups),
    )


def build_task_items(submission: NormalizedSubmission) -> list[TaskItem]:
    tasks: list[TaskItem] = []
    for index, image_url in enumerate(submission.exterior_images, start=1):
        tasks.append(
            TaskItem(
                submission_id=submission.submission_id,
                run_id=submission.run_id,
                workflow_code=submission.workflow_code,
                client_request_id=submission.client_request_id,
                callback_url=submission.callback_url,
                callback_token=submission.callback_token,
                car_name=submission.car_name,
                logo=submission.logo,
                feishu_app_id=submission.feishu_app_id,
                feishu_id=submission.feishu_id,
                expected_tasks=submission.expected_tasks,
                type="exterior",
                index=index,
                image_url=image_url,
            ),
        )

    for group_index, image_urls in enumerate(submission.interior_groups, start=1):
        tasks.append(
            TaskItem(
                submission_id=submission.submission_id,
                run_id=submission.run_id,
                workflow_code=submission.workflow_code,
                client_request_id=submission.client_request_id,
                callback_url=submission.callback_url,
                callback_token=submission.callback_token,
                car_name=submission.car_name,
                logo=submission.logo,
                feishu_app_id=submission.feishu_app_id,
                feishu_id=submission.feishu_id,
                expected_tasks=submission.expected_tasks,
                type="interior",
                group_index=group_index,
                image_urls=image_urls,
            ),
        )
    return tasks


def build_kie_payload(task: TaskItem, settings: Settings) -> dict[str, Any]:
    callback_url = settings.kie_callback_url()
    if task.type == "exterior":
        return {
            "model": settings.kie_model,
            "callBackUrl": callback_url,
            "input": {
                "prompt": EXTERIOR_PROMPT,
                "image_input": [task.image_url, task.logo],
                "aspect_ratio": "1:1",
                "resolution": "1K",
                "output_format": "jpg",
            },
        }

    return {
        "model": settings.kie_model,
        "callBackUrl": callback_url,
        "input": {
            "prompt": INTERIOR_PROMPT,
            "image_input": task.image_urls,
            "aspect_ratio": "1:1",
            "resolution": "1K",
            "output_format": "jpg",
        },
    }


def parse_kie_callback(body: dict[str, Any]) -> ParsedKieCallback:
    source_body = body.get("body") if isinstance(body.get("body"), dict) else body
    data = source_body.get("data") if isinstance(source_body.get("data"), dict) else {}
    result_json = _parse_result_json(data.get("resultJson"))
    result_urls = result_json.get("resultUrls") if isinstance(result_json, dict) else None
    result_url = None
    if isinstance(result_urls, list) and result_urls:
        result_url = str(result_urls[0] or "").strip() or None
    result_url = result_url or _clean_optional(source_body.get("resultUrl")) or _clean_optional(data.get("resultUrl"))
    task_id = (
        _clean_optional(data.get("taskId"))
        or _clean_optional(source_body.get("taskId"))
        or _clean_optional(source_body.get("id"))
    )
    raw_state = str(data.get("state") or source_body.get("state") or "").strip().lower()
    fail_code = _clean_optional(data.get("failCode")) or _clean_optional(source_body.get("failCode"))
    fail_msg = (
        _clean_optional(data.get("failMsg"))
        or _clean_optional(source_body.get("failMsg"))
        or _clean_optional(source_body.get("msg"))
    )

    if not task_id:
        raise WorkflowInputError("Callback contains no taskId")

    state = raw_state or "unknown"
    if result_url:
        state = "success"
    elif state in {"failed", "fail", "error"}:
        state = "failed"

    return ParsedKieCallback(
        task_id=task_id,
        state=state,
        raw_state=raw_state,
        result_url=result_url,
        fail_code=fail_code,
        fail_msg=fail_msg,
        body=source_body,
    )


def build_middle_platform_payload(final_assets: dict[str, Any]) -> dict[str, Any]:
    exterior = final_assets.get("exteriorImages") or []
    interior = final_assets.get("interiorImages") or []
    success_count = int(final_assets.get("successCount") or 0)
    failed_count = int(final_assets.get("failedCount") or 0)
    result_urls = [
        item["imageUrl"]
        for item in [*exterior, *interior]
        if isinstance(item, dict) and item.get("imageUrl")
    ]
    failed_tasks = final_assets.get("failedTasks") or []
    error_message = " | ".join(
        f"{task.get('type')}#{task.get('index') or '-'}: {task.get('failMsg') or task.get('failCode') or 'failed'}"
        for task in failed_tasks
        if isinstance(task, dict)
    )
    return {
        "run_id": final_assets.get("run_id"),
        "workflow_code": final_assets.get("workflow_code"),
        "status": "success" if success_count > 0 else "failed",
        "finished_at": format_finished_at(),
        "actual_completed_count": success_count,
        "result_summary": (
            f"WF-003 completed with {success_count} successful results and {failed_count} failed results"
            if success_count > 0
            else "WF-003 finished with 0 successful results"
        ),
        "result_summary_url": result_urls[0] if result_urls else None,
        "result_urls": result_urls,
        "external_task_id": final_assets.get("client_request_id") or final_assets.get("submissionId"),
        "error_message": error_message or None,
    }


def build_feishu_upload_items(final_assets: dict[str, Any]) -> list[dict[str, Any]]:
    now_ms = int(datetime.now().timestamp() * 1000)
    group_name = f"二手车图片组_{now_ms}"
    vehicle_id = f"car_{now_ms}"
    items: list[dict[str, Any]] = []

    for index, item in enumerate(final_assets.get("exteriorImages") or [], start=1):
        if isinstance(item, dict) and item.get("imageUrl"):
            items.append(
                {
                    "submissionId": final_assets["submissionId"],
                    "groupName": group_name,
                    "vehicleId": vehicle_id,
                    "feishu_app_id": final_assets["feishu_app_id"],
                    "feishu_id": final_assets["feishu_id"],
                    "category": "外观图",
                    "order": index,
                    "sourceUrl": item["imageUrl"],
                    "fileName": f"exterior_{index}.jpg",
                },
            )

    for index, item in enumerate(final_assets.get("interiorImages") or [], start=1):
        if isinstance(item, dict) and item.get("imageUrl"):
            items.append(
                {
                    "submissionId": final_assets["submissionId"],
                    "groupName": group_name,
                    "vehicleId": vehicle_id,
                    "feishu_app_id": final_assets["feishu_app_id"],
                    "feishu_id": final_assets["feishu_id"],
                    "category": "内饰图",
                    "order": index,
                    "sourceUrl": item["imageUrl"],
                    "fileName": f"interior_{index}.jpg",
                },
            )
    return items


def collect_attachments(upload_results: list[dict[str, Any]]) -> dict[str, Any]:
    first = upload_results[0] if upload_results else {}
    result = {
        "submissionId": first.get("submissionId", ""),
        "groupName": first.get("groupName", f"二手车图片组_{int(datetime.now().timestamp() * 1000)}"),
        "vehicleId": first.get("vehicleId", f"car_{int(datetime.now().timestamp() * 1000)}"),
        "feishu_app_id": first.get("feishu_app_id", ""),
        "feishu_id": first.get("feishu_id", ""),
        "exteriorAttachments": [],
        "interiorAttachments": [],
        "uploadFailures": [],
    }

    for item in upload_results:
        token = item.get("fileToken")
        if not token:
            result["uploadFailures"].append(
                {
                    "category": item.get("category", ""),
                    "order": item.get("order"),
                    "fileName": item.get("fileName", ""),
                    "sourceUrl": item.get("sourceUrl", ""),
                    "error": item.get("uploadError") or "Feishu upload failed after retries",
                },
            )
            continue

        attachment = {"file_token": token}
        if item.get("category") == "外观图":
            result["exteriorAttachments"].append(attachment)
        elif item.get("category") == "内饰图":
            result["interiorAttachments"].append(attachment)

    result["uploadSuccessCount"] = len(result["exteriorAttachments"]) + len(result["interiorAttachments"])
    result["uploadFailedCount"] = len(result["uploadFailures"])
    return result


def _make_submission_id() -> str:
    suffix = "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    return f"wf003_{int(datetime.now().timestamp() * 1000)}_{suffix}"


def _parse_result_json(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def _clean_optional(value: Any) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None
