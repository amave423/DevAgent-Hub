from __future__ import annotations

import os
from urllib.parse import urlencode

import httpx

from .models import WebSearchResponse, WebSearchResult


class WebSearchService:
    def __init__(self) -> None:
        self.default_base_url = os.getenv("DEVAGENT_SEARXNG_URL", "").strip()

    async def search(self, query: str, limit: int = 5, base_url: str | None = None) -> WebSearchResponse:
        resolved_base = (base_url or self.default_base_url).strip().rstrip("/")
        if not resolved_base:
            raise RuntimeError("Web search is not configured. Set a SearxNG URL in settings.")

        params = urlencode({"q": query, "format": "json", "language": "auto"})
        url = f"{resolved_base}/search?{params}"
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()

        results = []
        for item in payload.get("results", [])[:limit]:
            title = str(item.get("title") or "").strip()
            link = str(item.get("url") or "").strip()
            snippet = str(item.get("content") or item.get("snippet") or "").strip()
            if title and link:
                results.append(WebSearchResult(title=title, url=link, snippet=snippet))

        return WebSearchResponse(query=query, provider="searxng", results=results)
