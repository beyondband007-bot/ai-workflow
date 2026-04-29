import pytest

from wf003_worker.config import Settings
from wf003_worker.workflow import (
    WorkflowInputError,
    build_feishu_upload_items,
    build_interior_groups,
    build_kie_payload,
    build_middle_platform_payload,
    build_task_items,
    collect_attachments,
    normalize_submission,
    parse_kie_callback,
)


def settings() -> Settings:
    value = Settings()
    value.wf003_kie_callback_url = "https://worker.example.com/webhook/wf003-kie-callback"
    value.kie_api_key = "test"
    value.wf003_callback_token = "fallback-token"
    return value


def base_body(**overrides):
    body = {
        "car_name": "Demo Car",
        "exterior_images": ["https://cdn.example.com/exterior1.jpg"],
        "interior_images": ["https://cdn.example.com/interior1.jpg"],
        "logo": "https://cdn.example.com/logo.png",
        "run_id": "run_1",
        "client_request_id": "client_1",
        "workflow_code": "WF-003",
        "callback_url": "https://mid.example.com/api/v1/workflow-runs/wf003-callback",
        "callback_token": "callback-token",
        "feishu_app_id": "app_token",
        "feishu_id": "table_id",
    }
    body.update(overrides)
    return body


@pytest.mark.parametrize(
    ("count", "expected"),
    [
        (1, [[1]]),
        (2, [[1, 2]]),
        (3, [[1, 2, 3]]),
        (4, [[1, 2], [3, 4]]),
        (5, [[1, 2, 3], [4, 5]]),
    ],
)
def test_build_interior_groups(count, expected):
    assert build_interior_groups(list(range(1, count + 1))) == expected


def test_normalize_submission_and_task_count():
    submission = normalize_submission(
        base_body(
            exterior_images=["e1", "e2", "e3"],
            interior_images=["i1", "i2", "i3", "i4", "i5"],
            callback_token="",
        ),
        settings(),
    )

    assert submission.submission_id == "run_1"
    assert submission.callback_token == "fallback-token"
    assert submission.expected_tasks == 5
    tasks = build_task_items(submission)
    assert [task.type for task in tasks] == ["exterior", "exterior", "exterior", "interior", "interior"]


@pytest.mark.parametrize(
    "field",
    ["car_name", "exterior_images", "interior_images", "feishu_app_id", "feishu_id", "callback_url"],
)
def test_normalize_submission_required_fields(field):
    body = base_body()
    body[field] = [] if field.endswith("images") else ""

    with pytest.raises(WorkflowInputError):
        normalize_submission(body, settings())


def test_build_kie_payload_for_exterior_and_interior():
    submission = normalize_submission(base_body(interior_images=["i1", "i2", "i3", "i4"]), settings())
    exterior, interior = build_task_items(submission)[0], build_task_items(submission)[1]

    exterior_payload = build_kie_payload(exterior, settings())
    interior_payload = build_kie_payload(interior, settings())

    assert exterior_payload["model"] == "nano-banana-2"
    assert exterior_payload["callBackUrl"] == "https://worker.example.com/webhook/wf003-kie-callback"
    assert exterior_payload["input"]["image_input"] == ["https://cdn.example.com/exterior1.jpg", "https://cdn.example.com/logo.png"]
    assert interior_payload["input"]["image_input"] == ["i1", "i2"]


def test_parse_kie_callback_from_result_json_string():
    parsed = parse_kie_callback(
        {
            "data": {
                "taskId": "task_1",
                "state": "completed",
                "resultJson": '{"resultUrls":["https://cdn.example.com/result.jpg"]}',
            },
        },
    )

    assert parsed.task_id == "task_1"
    assert parsed.state == "success"
    assert parsed.result_url == "https://cdn.example.com/result.jpg"


def test_parse_kie_callback_failure_state():
    parsed = parse_kie_callback({"taskId": "task_1", "state": "fail", "failMsg": "bad input"})

    assert parsed.state == "failed"
    assert parsed.fail_msg == "bad input"


def test_parse_kie_callback_requires_task_id():
    with pytest.raises(WorkflowInputError):
        parse_kie_callback({"data": {"state": "success"}})


def test_middle_platform_payload_order_and_failed_summary():
    payload = build_middle_platform_payload(
        {
            "submissionId": "sub_1",
            "run_id": "run_1",
            "workflow_code": "WF-003",
            "client_request_id": "client_1",
            "successCount": 2,
            "failedCount": 1,
            "exteriorImages": [{"imageUrl": "e1"}, {"imageUrl": "e2"}],
            "interiorImages": [{"imageUrl": "i1"}],
            "failedTasks": [{"type": "interior", "index": 2, "failMsg": "timeout"}],
        },
    )

    assert payload["status"] == "success"
    assert payload["result_urls"] == ["e1", "e2", "i1"]
    assert payload["error_message"] == "interior#2: timeout"


def test_collect_attachments_supports_success_and_failure():
    collected = collect_attachments(
        [
            {"category": "外观图", "fileToken": "token_e", "submissionId": "sub_1"},
            {"category": "内饰图", "fileToken": "token_i", "submissionId": "sub_1"},
            {"category": "内饰图", "fileToken": "", "fileName": "bad.jpg", "uploadError": "no token"},
        ],
    )

    assert collected["exteriorAttachments"] == [{"file_token": "token_e"}]
    assert collected["interiorAttachments"] == [{"file_token": "token_i"}]
    assert collected["uploadFailedCount"] == 1


def test_build_feishu_upload_items_categories():
    items = build_feishu_upload_items(
        {
            "submissionId": "sub_1",
            "feishu_app_id": "app",
            "feishu_id": "table",
            "exteriorImages": [{"imageUrl": "e1"}],
            "interiorImages": [{"imageUrl": "i1"}],
        },
    )

    assert [item["category"] for item in items] == ["外观图", "内饰图"]
    assert [item["fileName"] for item in items] == ["exterior_1.jpg", "interior_1.jpg"]
