from __future__ import annotations

from typing import Any

import httpx

from .config import Settings


class MiddlePlatformClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def notify(self, callback_url: str, callback_token: str, payload: dict[str, Any]) -> dict[str, Any]:
        if not callback_url:
            raise RuntimeError("callback_url is required")

        async with httpx.AsyncClient(timeout=self.settings.http_timeout_seconds) as client:
            response = await client.post(
                callback_url,
                headers={"x-workflow-callback-token": callback_token or ""},
                json=payload,
            )
            text = response.text
            response.raise_for_status()

        try:
            return response.json()
        except ValueError:
            return {"raw": text}
