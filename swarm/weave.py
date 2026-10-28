"""Weave job: read candidates, propose things/edges, optionally ground with You.com."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

SYSTEM = """You weave a personal life graph from memories that already exist.
Reply with JSON only:
{"things":[{"type":"entity|goal|project|habit","name":"","kind":"person|organization|place|object|concept|event|group","summary":""}],"edges":[{"source":"","target":"","kind":"part_of|supports|pursues|practices|prefers|dislikes|located_at|knows|related","evidence":["memory-id"]}]}
Rules:
- Copy names from the memories. Never invent a name that is not written there.
- Prefer linking the same person/project across different memory sources.
- goal/project/habit are typed life objects. Everything else is entity.
- If nothing is established, return {"things":[],"edges":[]}.
"""


def main() -> int:
    job = json.load(sys.stdin)
    data = job.get("data") or {}
    base = os.environ.get("SCORIA_API_URL", "http://127.0.0.1:8080").rstrip("/")
    token = os.environ.get("SCORIA_API_TOKEN", "")
    headers = {"authorization": f"Bearer {token}"} if token else {}

    with httpx.Client(timeout=45) as http:
        cand = http.get(f"{base}/graph/candidates", params={"limit": 40}, headers=headers)
        cand.raise_for_status()
        snapshot = cand.json()
        memories = snapshot.get("memories") or []
        if not memories:
            print(json.dumps({"skipped": True, "reason": "no memories"}))
            return 0
        conclusion = _conclude(memories, snapshot.get("things") or [])
        wrote = {"things": 0, "edges": 0, "grounded": 0}
        allowed = _names(memories)
        for thing in conclusion.get("things") or []:
            name = str(thing.get("name") or "")
            if not _mentioned(name, allowed):
                continue
            r = http.post(
                f"{base}/graph/entities",
                json=thing,
                headers=headers,
            )
            if r.is_success:
                wrote["things"] += 1
        for edge in conclusion.get("edges") or []:
            src, dst = str(edge.get("source") or ""), str(edge.get("target") or "")
            if not (_mentioned(src, allowed) and _mentioned(dst, allowed)):
                continue
            r = http.post(
                f"{base}/graph/edges",
                json={
                    "source": src,
                    "target": dst,
                    "kind": edge.get("kind") or "related",
                    "evidence": edge.get("evidence") or [data.get("memory_id")],
                    "status": "proposed",
                },
                headers=headers,
            )
            if r.is_success:
                wrote["edges"] += 1
        public = [
            t
            for t in (conclusion.get("things") or [])
            if t.get("kind") in {"organization", "place"}
        ]
        wrote["grounded"] = _ground_thin(http, base, headers, public)
        if os.environ.get("SCORIA_USE_CREWAI") == "1":
            try:
                from swarm.crew import run_crew

                extra = run_crew(snapshot)
                wrote["crew"] = extra
            except Exception as exc:  # noqa: BLE001
                wrote["crew_error"] = str(exc)
    print(json.dumps(wrote))
    return 0


def _conclude(memories: list, things: list) -> dict:
    key = os.environ.get("PARASAIL_API_KEY")
    if not key:
        return {"things": [], "edges": []}
    client = OpenAI(base_url=os.environ.get("PARASAIL_BASE_URL", "https://api.parasail.io/v1"), api_key=key)
    model = os.environ.get("PARASAIL_MODEL", "parasail-glm-53-flash")
    blob = json.dumps({"memories": memories[:20], "existing": things[:40]}, default=str)[:12000]
    resp = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": blob},
        ],
        response_format={"type": "json_object"},
        extra_body={"store": False},
    )
    content = resp.choices[0].message.content or "{}"
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        return {"things": [], "edges": []}


def _names(memories: list) -> str:
    return "\n".join(
        f"{m.get('title') or ''} {m.get('body') or ''}" for m in memories
    ).lower()


def _mentioned(name: str, haystack: str) -> bool:
    name = name.strip()
    return bool(name) and name.lower() in haystack


def _ground_thin(http: httpx.Client, base: str, headers: dict, things: list) -> int:
    key = os.environ.get("YDC_API_KEY") or os.environ.get("YOU_WEB_SEARCH_TOKEN")
    if not key:
        return 0
    public = [
        t
        for t in things
        if t.get("kind") in {"organization", "place"} or t.get("data_class") == "entity"
    ][:2]
    n = 0
    for thing in public:
        name = thing.get("name")
        if not name:
            continue
        try:
            r = httpx.get(
                "https://api.you.com/v1/search",
                params={"query": str(name), "count": 3},
                headers={"X-API-Key": key},
                timeout=20,
            )
            if r.status_code >= 400:
                continue
            hits = ((r.json().get("results") or {}).get("web") or [])[:3]
            body = "\n".join(
                f"{h.get('title')}: {h.get('description') or h.get('url')}"
                for h in hits
                if isinstance(h, dict)
            )
            if not body:
                continue
            wr = http.post(
                f"{base}/memory",
                json={
                    "kind": "research",
                    "title": f"Grounding: {name}",
                    "body": body,
                    "source": "you:research",
                    "source_id": f"you:{re.sub(r'[^a-z0-9]+', '-', name.lower())[:40]}",
                },
                headers=headers,
            )
            if wr.is_success:
                n += 1
        except Exception:
            continue
    return n


if __name__ == "__main__":
    raise SystemExit(main())
