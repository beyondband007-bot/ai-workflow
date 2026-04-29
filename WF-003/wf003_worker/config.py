from functools import lru_cache
import os


def _int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name)
    if not raw_value:
        return default
    try:
        return int(raw_value)
    except ValueError:
        return default


class Settings:
    database_host: str = os.getenv("DATABASE_HOST", "127.0.0.1")
    database_port: int = _int_env("DATABASE_PORT", 3306)
    database_username: str = os.getenv("DATABASE_USERNAME", "app_user")
    database_password: str = os.getenv("DATABASE_PASSWORD", "")
    database_name: str = os.getenv("DATABASE_NAME", "auth_demo")

    kie_api_key: str = os.getenv("KIE_API_KEY", "")
    kie_create_task_url: str = os.getenv(
        "KIE_CREATE_TASK_URL",
        "https://api.kie.ai/api/v1/jobs/createTask",
    )
    kie_record_info_url: str = os.getenv(
        "KIE_RECORD_INFO_URL",
        "https://api.kie.ai/api/v1/jobs/recordInfo",
    )
    kie_model: str = os.getenv("KIE_IMAGE_MODEL", "nano-banana-2")

    wf003_public_base_url: str = (
        os.getenv("WF003_PUBLIC_BASE_URL")
        or os.getenv("MIDDLE_PLATFORM_PUBLIC_BASE_URL")
        or ""
    ).rstrip("/")
    wf003_kie_callback_url: str = os.getenv("WF003_KIE_CALLBACK_URL", "").strip()
    wf003_callback_token: str = os.getenv("WF_003_CALLBACK_TOKEN", "").strip()

    http_timeout_seconds: float = float(os.getenv("WF003_HTTP_TIMEOUT_SECONDS", "60"))
    poll_enabled: bool = os.getenv("WF003_POLL_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    poll_interval_seconds: float = float(os.getenv("WF003_POLL_INTERVAL_SECONDS", "60"))
    poll_batch_size: int = _int_env("WF003_POLL_BATCH_SIZE", 20)
    feishu_retry_count: int = _int_env("WF003_FEISHU_RETRY_COUNT", 4)
    feishu_retry_delay_seconds: float = float(
        os.getenv("WF003_FEISHU_RETRY_DELAY_SECONDS", "5"),
    )
    feishu_upload_delay_seconds: float = float(
        os.getenv("WF003_FEISHU_UPLOAD_DELAY_SECONDS", "2"),
    )

    feishu_app_id: str = os.getenv("FEISHU_APP_ID", "")
    feishu_app_secret: str = os.getenv("FEISHU_APP_SECRET", "")
    feishu_base_url: str = os.getenv("FEISHU_BASE_URL", "https://open.feishu.cn")

    feishu_field_number: str = os.getenv("WF003_FEISHU_FIELD_NUMBER", "编号")
    feishu_field_car_name: str = os.getenv("WF003_FEISHU_FIELD_CAR_NAME", "车名")
    feishu_field_exterior: str = os.getenv("WF003_FEISHU_FIELD_EXTERIOR", "外观附件")
    feishu_field_interior: str = os.getenv("WF003_FEISHU_FIELD_INTERIOR", "内饰附件")

    def kie_callback_url(self) -> str:
        if self.wf003_kie_callback_url:
            return self.wf003_kie_callback_url
        if os.getenv("MIDDLE_PLATFORM_PUBLIC_BASE_URL"):
            return (
                f"{os.getenv('MIDDLE_PLATFORM_PUBLIC_BASE_URL', '').rstrip('/')}"
                "/api/v1/workflow-runs/wf003-kie-callback-proxy"
            )
        if self.wf003_public_base_url:
            return f"{self.wf003_public_base_url}/webhook/wf003-kie-callback"
        raise ValueError("WF003_KIE_CALLBACK_URL or WF003_PUBLIC_BASE_URL is required")


@lru_cache
def get_settings() -> Settings:
    return Settings()
