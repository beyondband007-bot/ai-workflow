from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class KieClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def create_task(self, payload: dict[str, Any]) -> str:
        if not self.settings.kie_api_key:
            raise RuntimeError("KIE_API_KEY is not configured")

        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            response = await client.post(
                self.settings.kie_create_task_url,
                headers={"Authorization": f"Bearer {self.settings.kie_api_key}"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        if int(data.get("code") or 0) != 200:
            raise RuntimeError(data.get("msg") or data.get("message") or "Kie createTask failed")

        response_data = data.get("data")
        if not isinstance(response_data, dict):
            raise RuntimeError(data.get("msg") or "Kie createTask returned no data")

        task_id = response_data.get("taskId")
        if not task_id:
            raise RuntimeError("Kie createTask returned no taskId")
        return str(task_id)

    async def get_task_record(self, task_id: str) -> dict[str, Any]:
        if not self.settings.kie_api_key:
            raise RuntimeError("KIE_API_KEY is not configured")

        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            response = await client.get(
                self.settings.kie_record_info_url,
                headers={"Authorization": f"Bearer {self.settings.kie_api_key}"},
                params={"taskId": task_id},
            )
            response.raise_for_status()
            data = response.json()

        if int(data.get("code") or 0) != 200:
            raise RuntimeError(data.get("msg") or data.get("message") or "Kie recordInfo failed")
        record = data.get("data")
        if not isinstance(record, dict):
            raise RuntimeError("Kie recordInfo returned no data")
        return record
