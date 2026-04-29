from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .config import Settings


class FeishuClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._tenant_token: str | None = None
        self._tenant_token_expires_at = 0.0

    async def upload_by_url(self, item: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(self.settings.feishu_upload_delay_seconds)
        last_error = ""
        for attempt in range(1, self.settings.feishu_retry_count + 1):
            try:
                token = await self._upload_once(item)
                return {**item, "fileToken": token, "uploadStatus": "success", "uploadError": None}
            except Exception as error:  # noqa: BLE001 - preserve n8n continue-on-fail style
                last_error = str(error)
                if attempt < self.settings.feishu_retry_count:
                    await asyncio.sleep(self.settings.feishu_retry_delay_seconds)

        return {**item, "fileToken": "", "uploadStatus": "failed", "uploadError": last_error}

    async def create_bitable_record(self, attachments: dict[str, Any], car_name: str) -> dict[str, Any]:
        token = await self._tenant_access_token()
        app_token = attachments.get("feishu_app_id")
        table_id = attachments.get("feishu_id")
        if not app_token or not table_id:
            raise RuntimeError("feishu_app_id and feishu_id are required")

        payload = {
            "fields": {
                self.settings.feishu_field_number: str(int(time.time() * 1000)),
                self.settings.feishu_field_car_name: car_name or "",
                self.settings.feishu_field_exterior: attachments.get("exteriorAttachments") or [],
                self.settings.feishu_field_interior: attachments.get("interiorAttachments") or [],
            },
        }
        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.feishu_base_url}/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()

    async def _upload_once(self, item: dict[str, Any]) -> str:
        token = await self._tenant_access_token()
        source_url = item.get("sourceUrl")
        if not source_url:
            raise RuntimeError("sourceUrl is required")

        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            source_response = await client.get(source_url)
            source_response.raise_for_status()
            upload_response = await client.post(
                f"{self.settings.feishu_base_url}/open-apis/drive/v1/medias/upload_all",
                headers={"Authorization": f"Bearer {token}"},
                data={
                    "file_name": item.get("fileName") or "wf003.jpg",
                    "parent_type": "bitable_file",
                    "parent_node": item.get("feishu_app_id") or "",
                    "size": str(len(source_response.content)),
                },
                files={
                    "file": (
                        item.get("fileName") or "wf003.jpg",
                        source_response.content,
                        source_response.headers.get("content-type") or "image/jpeg",
                    ),
                },
            )
            try:
                upload_response.raise_for_status()
            except httpx.HTTPStatusError as error:
                raise RuntimeError(f"Feishu upload failed: {upload_response.text}") from error
            data = upload_response.json()

        file_token = data.get("data", {}).get("file_token") or data.get("file_token")
        if not file_token:
            raise RuntimeError("Feishu upload returned no file_token after retries")
        return str(file_token)

    async def _tenant_access_token(self) -> str:
        if self._tenant_token and time.time() < self._tenant_token_expires_at - 60:
            return self._tenant_token
        if not self.settings.feishu_app_id or not self.settings.feishu_app_secret:
            raise RuntimeError("FEISHU_APP_ID and FEISHU_APP_SECRET are required")

        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            response = await client.post(
                f"{self.settings.feishu_base_url}/open-apis/auth/v3/tenant_access_token/internal",
                json={
                    "app_id": self.settings.feishu_app_id,
                    "app_secret": self.settings.feishu_app_secret,
                },
            )
            response.raise_for_status()
            data = response.json()

        token = data.get("tenant_access_token")
        if not token:
            raise RuntimeError(data.get("msg") or "Feishu returned no tenant_access_token")
        self._tenant_token = str(token)
        self._tenant_token_expires_at = time.time() + int(data.get("expire") or 7200)
        return self._tenant_token
