from __future__ import annotations

from typing import Any

import httpx


class SpctreClient:
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout: float = 5.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self._owns_client = http_client is None
        self._client = http_client or httpx.AsyncClient(timeout=timeout)

    async def evaluate(self, payload: dict[str, Any]) -> dict[str, Any]:
        response = await self._client.post(
            self._url("/evaluate"),
            headers=self._headers(),
            json=payload,
        )
        response.raise_for_status()
        return response.json()

    async def ingest_evidence(self, record: dict[str, Any]) -> dict[str, Any] | None:
        response = await self._client.post(
            self._url("/evidence"),
            headers=self._headers(),
            json=record,
        )
        response.raise_for_status()
        if response.content:
            return response.json()
        return None

    async def aclose(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.api_key}"}
