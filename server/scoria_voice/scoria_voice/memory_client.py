"""Scoria memory for the brain: the same HTTP contract the Flutter app uses."""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx

log = logging.getLogger("scoria.voice.memory")


class MemoryClient:
    def __init__(self, base_url: str, handle: str | None, password: str | None):
        self.base = base_url.rstrip("/")
        self.handle = handle
        self.password = password
        self.token: str | None = None
        self.person: dict | None = None
        self._http = httpx.AsyncClient(timeout=15)

    @property
    def available(self) -> bool:
        return self.token is not None

    async def sign_in(self) -> bool:
        if not (self.handle and self.password):
            return False
        try:
            r = await self._http.post(f"{self.base}/auth/signin", json={"handle": self.handle, "password": self.password})
            if r.status_code != 200:
                log.warning("scoria sign-in refused: %s", r.text[:200])
                return False
            d = r.json()
            self.token, self.person = d["token"], d["person"]
            return True
        except httpx.HTTPError as e:
            log.warning("scoria api unreachable: %s", e)
            return False

    def _h(self) -> dict[str, str]:
        return {"authorization": f"Bearer {self.token}"} if self.token else {}

    async def recent(self, limit: int = 20) -> list[dict[str, Any]]:
        r = await self._http.get(f"{self.base}/memory", params={"limit": limit}, headers=self._h())
        r.raise_for_status()
        return r.json()

    async def search(self, q: str, limit: int = 8) -> list[dict[str, Any]]:
        r = await self._http.post(f"{self.base}/memory/search", json={"q": q, "limit": limit}, headers=self._h())
        if r.status_code == 501:
            # No embeddings yet: cheap keyword fallback over the recent feed.
            words = [w.lower() for w in q.split() if len(w) > 2]
            feed = await self.recent(100)
            scored = []
            for m in feed:
                hay = f"{m.get('title') or ''} {m.get('body') or ''}".lower()
                score = sum(hay.count(w) for w in words)
                if score:
                    scored.append((score, m))
            scored.sort(key=lambda t: -t[0])
            return [m for _, m in scored[:limit]]
        r.raise_for_status()
        return r.json()

    async def remember(self, title: str, body: str | None, kind: str = "note", source: str = "voice") -> dict[str, Any]:
        payload = {
            "kind": kind,
            "title": title,
            "body": body,
            "occurred_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": source,
            "source_id": f"{source}-{int(time.time() * 1000)}",
        }
        r = await self._http.post(f"{self.base}/memory", json=payload, headers=self._h())
        r.raise_for_status()
        return r.json()

    async def close(self) -> None:
        await self._http.aclose()
