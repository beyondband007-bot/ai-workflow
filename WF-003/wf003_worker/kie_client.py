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

        task_id = data.get("data", {}).get("taskId")
        if not task_id:
            raise RuntimeError("Kie createTask returned no taskId")
        return str(task_id)
