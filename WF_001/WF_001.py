import argparse
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

WORKFLOW_CODE = "WF-001"
API_TOKEN = "c521060b9a55ae31b09cae042a8599fa"
KIE_API_HOST = "api.kie.ai"
MIDDLE_PLATFORM_BASE = os.getenv(
    "MIDDLE_PLATFORM_BASE", "http://127.0.0.1:3002/api/v1"
).rstrip("/")
MIDDLE_PLATFORM_TOKEN = os.getenv("MIDDLE_PLATFORM_TOKEN", "").strip()
CALLBACK_SIGNING_SECRET = os.getenv("CALLBACK_SIGNING_SECRET", "").strip()
CALLBACK_URL = os.getenv("KIE_AI_CALLBACK_URL", "").strip()
OUTPUT_DIR = os.getenv(
    "WF_001_OUTPUT_DIR", os.path.dirname(os.path.abspath(__file__))
)
ALLOWED_ASPECT_RATIOS = ("1:1", "4:3", "3:4", "16:9", "9:16")


def upload_image(local_path: str) -> str:
    if not os.path.isfile(local_path):
        raise FileNotFoundError(f"Image file not found: {local_path}")

    mime_type, _ = mimetypes.guess_type(local_path)
    mime_type = mime_type or "application/octet-stream"
    filename = os.path.basename(local_path)
    boundary = uuid.uuid4().hex

    with open(local_path, "rb") as file_handle:
        file_data = file_handle.read()

    body = f"--{boundary}\r\n".encode()
    body += (
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
    ).encode()
    body += f"Content-Type: {mime_type}\r\n\r\n".encode()
    body += file_data
    body += f"\r\n--{boundary}--\r\n".encode()

    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }

    conn = http.client.HTTPSConnection(KIE_API_HOST)
    conn.request("POST", "/api/v1/files/upload", body, headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()

    payload = json.loads(raw)
    if payload.get("code") != 200:
        raise RuntimeError(f"Image upload failed: {payload}")

    return payload["data"]["url"]


def create_task(prompt: str, aspect_ratio: str, image_url: str = "") -> str:
    input_payload = {
        "prompt": prompt,
        "aspect_ratio": aspect_ratio,
        "nsfw_checker": True,
    }

    if image_url:
        input_payload["image_url"] = image_url

    payload = {"model": "gpt-image-2-text-to-image", "input": input_payload}
    if CALLBACK_URL:
        payload["callBackUrl"] = CALLBACK_URL

    conn = http.client.HTTPSConnection(KIE_API_HOST)
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    conn.request("POST", "/api/v1/jobs/createTask", json.dumps(payload), headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()

    data = json.loads(raw)
    if data.get("code") != 200:
        raise RuntimeError(f"Task creation failed: {data}")

    return data["data"]["taskId"]


def query_task(task_id: str) -> dict:
    conn = http.client.HTTPSConnection(KIE_API_HOST)
    headers = {
        "Authorization": f"Bearer {API_TOKEN}",
        "Content-Type": "application/json",
    }
    encoded_task_id = urllib.parse.quote(task_id, safe="")
    conn.request("GET", f"/api/v1/jobs/recordInfo?taskId={encoded_task_id}", headers=headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()
    return json.loads(raw)


def find_status(payload: dict) -> str:
    for key in ("status", "taskStatus", "task_status", "state"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value

    for value in payload.values():
        if isinstance(value, dict):
            nested = find_status(value)
            if nested:
                return nested

    return "unknown"


def wait_for_result(task_id: str, poll_interval: int = 5, timeout: int = 300) -> dict:
    elapsed = 0
    while elapsed < timeout:
        result = query_task(task_id)
        status = find_status(result).upper()
        print(f"[{elapsed:>4}s] task status: {status}")

        if status in {"SUCCESS", "COMPLETED", "FINISH", "FINISHED", "DONE"}:
            return result
        if status in {"FAILED", "FAIL", "ERROR"}:
            return result

        time.sleep(poll_interval)
        elapsed += poll_interval

    raise TimeoutError(f"Task timeout after {timeout} seconds")


def extract_urls(value, collected=None):
    if collected is None:
        collected = []

    if isinstance(value, str):
        stripped = value.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                parsed = None
            if parsed is not None:
                extract_urls(parsed, collected)
        lowered = value.lower()
        if value.startswith("http") and (
            lowered.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif"))
            or any(f".{ext}?" in lowered for ext in ("png", "jpg", "jpeg", "webp", "gif"))
        ):
            collected.append(value)
    elif isinstance(value, list):
        for item in value:
            extract_urls(item, collected)
    elif isinstance(value, dict):
        for item in value.values():
            extract_urls(item, collected)

    return collected


def save_images(result: dict) -> list[str]:
    urls = extract_urls(result)
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    saved_paths = []
    for index, url in enumerate(urls):
        extension = os.path.splitext(url.split("?")[0])[-1] or ".png"
        file_name = f"wf001_{int(time.time())}_{index}{extension}"
        output_path = os.path.join(OUTPUT_DIR, file_name)
        urllib.request.urlretrieve(url, output_path)
        saved_paths.append(output_path)

    return saved_paths


def http_json_request(
    method: str,
    url: str,
    payload: dict | None = None,
    user_id: str = "",
) -> dict:
    parsed = urllib.parse.urlparse(url)
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if (
        CALLBACK_SIGNING_SECRET
        and payload is not None
        and parsed.path.rstrip("/").endswith("/workflow-runs/callback")
    ):
        timestamp = str(int(time.time()))
        headers["X-Callback-Timestamp"] = timestamp
        headers["X-Callback-Signature"] = sign_callback_payload(payload, timestamp)
    if MIDDLE_PLATFORM_TOKEN:
        headers["Authorization"] = MIDDLE_PLATFORM_TOKEN
    elif user_id:
        headers["X-User-Id"] = user_id
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    connection_cls = (
        http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    )
    conn = connection_cls(parsed.hostname, parsed.port)
    conn.request(method, path, body=body, headers=headers)
    response = conn.getresponse()
    raw = response.read().decode("utf-8")
    conn.close()

    if response.status >= 400:
        raise RuntimeError(f"{method} {url} failed with {response.status}: {raw}")

    data = json.loads(raw)
    if isinstance(data, dict) and "code" in data:
        if data.get("code") != 0:
            raise RuntimeError(f"{method} {url} returned business error: {data}")
        return data["data"]

    return data


def sign_callback_payload(payload: dict, timestamp: str) -> str:
    message = f"{timestamp}.{stable_json(payload)}".encode("utf-8")
    return hmac.new(
        CALLBACK_SIGNING_SECRET.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()


def stable_json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def register_run(client_request_id: str, request_payload_summary: dict, user_id: str) -> dict:
    payload = {
        "workflow_code": WORKFLOW_CODE,
        "client_request_id": client_request_id,
        "request_payload_summary": request_payload_summary,
    }
    return http_json_request(
        "POST", f"{MIDDLE_PLATFORM_BASE}/workflow-runs/register", payload, user_id
    )


def callback_run(
    run_id: str,
    status: str,
    result_summary: str,
    result_urls: list[str],
    external_task_id: str = "",
    error_message: str = "",
) -> dict:
    payload = {
        "run_id": run_id,
        "workflow_code": WORKFLOW_CODE,
        "status": status,
        "finished_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "result_summary": result_summary,
        "result_urls": result_urls,
        "external_task_id": external_task_id,
        "error_message": error_message,
    }
    return http_json_request(
        "POST", f"{MIDDLE_PLATFORM_BASE}/workflow-runs/callback", payload
    )


def prompt_user_inputs(args: argparse.Namespace) -> tuple[str, str, str]:
    prompt = args.prompt.strip() if args.prompt else ""
    if not prompt:
        print("Enter prompt for WF-001. Press Enter to use the default prompt:")
        prompt = input(">>> ").strip()

    if not prompt:
        prompt = (
            "Generate a photorealistic image of a cafe terrace in the Marais district "
            "of Paris on a Wednesday morning in March 2025."
        )

    image_path = args.image.strip() if args.image else ""
    if not args.no_image and not image_path:
        print("Optional reference image path. Press Enter to skip:")
        image_path = input(">>> ").strip().strip('"').strip("'")

    aspect_ratio = args.aspect_ratio.strip() if args.aspect_ratio else "1:1"
    if aspect_ratio not in ALLOWED_ASPECT_RATIOS:
        raise ValueError(
            f"Invalid aspect ratio: {aspect_ratio}. Allowed values: {', '.join(ALLOWED_ASPECT_RATIOS)}"
        )

    return prompt, image_path, aspect_ratio


def build_request_summary(prompt: str, image_path: str, aspect_ratio: str) -> dict:
    return {
        "workflow_code": WORKFLOW_CODE,
        "prompt_preview": prompt[:120],
        "aspect_ratio": aspect_ratio,
        "has_reference_image": bool(image_path),
        "reference_image_path": image_path or "",
        "executor_type": "python",
        "billing_mode": "fixed_points",
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="WF-001 middleware-integrated runner")
    parser.add_argument("--prompt", default="", help="Prompt text")
    parser.add_argument("--image", default="", help="Local reference image path")
    parser.add_argument("--client-request-id", default="", help="Idempotent request id")
    parser.add_argument(
        "--aspect-ratio",
        default="1:1",
        choices=ALLOWED_ASPECT_RATIOS,
        help="Output aspect ratio",
    )
    parser.add_argument("--poll-interval", type=int, default=5, help="Task poll interval seconds")
    parser.add_argument("--timeout", type=int, default=300, help="Task timeout seconds")
    parser.add_argument("--no-image", action="store_true", help="Skip image prompt")
    parser.add_argument("--user-id", default="suppertest", help="Middleware user_id")
    parser.add_argument(
        "--mock-mode",
        choices=("off", "success", "failed"),
        default=os.getenv("WF_001_MOCK_MODE", "off"),
        help="Use mock workflow execution instead of external API",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prompt, image_path, aspect_ratio = prompt_user_inputs(args)

    request_summary = build_request_summary(prompt, image_path, aspect_ratio)
    client_request_id = args.client_request_id or f"wf001_{uuid.uuid4().hex[:12]}"

    print("\n[1/4] register to middleware")
    register_data = register_run(client_request_id, request_summary, args.user_id)
    run_id = register_data["run_id"]
    print(json.dumps(register_data, ensure_ascii=False, indent=2))

    try:
        print("\n[2/4] execute workflow")
        if args.mock_mode != "off":
            time.sleep(2)
            callback_status = "success" if args.mock_mode == "success" else "failed"
            result_summary = (
                "WF-001 mock execution success"
                if callback_status == "success"
                else "WF-001 mock execution failed"
            )
            callback_data = callback_run(
                run_id=run_id,
                status=callback_status,
                result_summary=result_summary,
                result_urls=[],
                external_task_id=f"mock_{uuid.uuid4().hex[:8]}",
                error_message="" if callback_status == "success" else "Mock failure for WF-001",
            )
            print(json.dumps(callback_data, ensure_ascii=False, indent=2))
            return 0 if callback_status == "success" else 1

        image_url = upload_image(image_path) if image_path else ""
        task_id = create_task(prompt, aspect_ratio, image_url)
        print(f"task_id: {task_id}")

        print("\n[3/4] wait result")
        result = wait_for_result(task_id, args.poll_interval, args.timeout)
        result_urls = extract_urls(result)
        status = find_status(result).upper()
        if status in {"SUCCESS", "COMPLETED", "FINISH", "FINISHED", "DONE"} and not result_urls:
            raise RuntimeError("WF-001 completed without any image URLs")

        saved_paths = []
        download_warning = ""
        if result_urls:
            try:
                saved_paths = save_images(result)
            except Exception as download_exc:
                download_warning = f" image_download_warning={download_exc}"
                print(
                    f"\nImage download skipped due to error: {download_exc}",
                    file=sys.stderr,
                )

        callback_status = "success" if status in {
            "SUCCESS",
            "COMPLETED",
            "FINISH",
            "FINISHED",
            "DONE",
        } else "failed"
        result_summary = (
            f"WF-001 finished with status={status}, result_urls={len(result_urls)}, saved_images={len(saved_paths)}{download_warning}"
        )

        print("\n[4/4] callback to middleware")
        callback_data = callback_run(
            run_id=run_id,
            status=callback_status,
            result_summary=result_summary,
            result_urls=result_urls,
            external_task_id=task_id,
            error_message="" if callback_status == "success" else json.dumps(result, ensure_ascii=False)[:500],
        )
        print(json.dumps(callback_data, ensure_ascii=False, indent=2))
        print("\nSaved files:")
        for path in saved_paths:
          print(path)
        return 0
    except Exception as exc:
        print(f"\nExecution failed: {exc}", file=sys.stderr)
        callback_data = callback_run(
            run_id=run_id,
            status="failed",
            result_summary="WF-001 failed before completion",
            result_urls=[],
            external_task_id="",
            error_message=str(exc),
        )
        print(json.dumps(callback_data, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
