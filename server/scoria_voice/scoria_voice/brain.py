"""The brain: a local LLM with memory and web tools that decides what the voice says.

For every user utterance the brain either stays out of the way (small talk —
PersonaPlex handles it better and faster) or answers with tools and hands the
voice two things: a short spoken reply (forced onto the text stream) and a
fact brief (injected as a `<system>` block) so follow-ups stay grounded.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx
import ollama

from .memory_client import MemoryClient
from .persona import Persona

log = logging.getLogger("scoria.voice.brain")

NOOP = "NOOP"

KEEP_ALIVE = "2h"  # keep the brain resident in Ollama between utterances

SYSTEM = """You are the second mind behind a spoken voice persona. The persona (a small speech model) is already talking to the user in real time; it is charming but it does not know the user's life, cannot browse, and cannot use tools. You can.

The user's words arrive from speech recognition and may contain errors; read them charitably ("There is the week is it today" means "what day of the week is it today").

For each user utterance decide:
- If it is pure small talk, a greeting, a reaction, or an opinion the persona can give on its own, reply with exactly: NOOP
- NEVER reply NOOP when the user asks about anything factual: the date or time, news, sports, weather, places, people, prices, history, science, or anything about the user's own life, plans or past. The persona WILL make something up if you stay silent, so you must answer. Use your tools (time, web, memory) first when they would make the answer correct.
- Reply with what the voice should SAY: at most two short sentences of plain spoken English. No markdown, no lists, no URLs, no preamble. Say numbers as words when natural.

When the user asks to change how the voice speaks (slower, call them by a name, be funnier, speak Spanish...), call update_persona with a concise instruction and reply NOOP unless an acknowledgement is needed.
When the user tells you something worth keeping (a plan, a preference, a fact about their life), call remember.
Prefer memory_search before web_search for anything about the user, their people, places, or past.

Current local date and time: {now}

Persona meta prompt right now:
{persona}
"""

TOOLS: list[dict[str, Any]] = [
    {"type": "function", "function": {"name": "memory_search", "description": "Search the user's personal memory (notes, events, places, people, conversations).", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "memory_recent", "description": "Most recent items in the user's memory feed.", "parameters": {"type": "object", "properties": {"limit": {"type": "integer", "default": 10}}}}},
    {"type": "function", "function": {"name": "remember", "description": "Save a note to the user's memory.", "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "body": {"type": "string"}}, "required": ["title"]}}},
    {"type": "function", "function": {"name": "web_search", "description": "Search the web. Returns titles, URLs and snippets.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}}},
    {"type": "function", "function": {"name": "fetch_url", "description": "Fetch a web page and return its readable text (truncated).", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}}},
    {"type": "function", "function": {"name": "now", "description": "Current local date and time.", "parameters": {"type": "object", "properties": {}}}},
    {"type": "function", "function": {"name": "update_persona", "description": "Add a standing instruction about how the voice should speak or behave.", "parameters": {"type": "object", "properties": {"instruction": {"type": "string"}}, "required": ["instruction"]}}},
]


@dataclass
class BrainEvent:
    kind: str  # thinking | tool | say | brief | noop | error | persona
    text: str
    ts: float = field(default_factory=time.time)
    data: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"kind": self.kind, "text": self.text, "ts": self.ts, **({"data": self.data} if self.data else {})}


OnEvent = Callable[[BrainEvent], Awaitable[None]]


async def pick_brain_model(client: ollama.AsyncClient, preferred: str | None, candidates: list[str]) -> str | None:
    try:
        resp = await client.list()
    except Exception as e:  # noqa: BLE001
        log.warning("ollama unreachable: %s", e)
        return None
    present = {m.model for m in resp.models}
    if preferred and preferred in present:
        return preferred
    for c in candidates:
        if c in present:
            return c
    return next(iter(sorted(present)), None)


class Brain:
    def __init__(self, cfg, memory: MemoryClient | None, persona: Persona, on_event: OnEvent, on_persona_change: Callable[[str], Awaitable[None]]):
        self.cfg = cfg
        self.client = ollama.AsyncClient(host=cfg.ollama_url)
        self.model: str | None = None
        self.memory = memory
        self.persona = persona
        self.on_event = on_event
        self.on_persona_change = on_persona_change
        self.history: list[dict[str, Any]] = []  # recent dialogue, both sides
        self._busy = asyncio.Lock()
        self._http = httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"user-agent": "scoria-voice/0.1"})

    async def start(self) -> None:
        self.model = await pick_brain_model(self.client, self.cfg.brain_model, self.cfg.brain_candidates)
        log.info("brain model: %s", self.model)
        # Pre-load and pin the model so the first utterance does not pay a 10 s cold start.
        try:
            await self.client.chat(model=self.model, messages=[{"role": "user", "content": "hi"}], options={"num_predict": 1}, keep_alive=KEEP_ALIVE)
        except Exception as e:  # noqa: BLE001
            log.warning("brain warm-up failed: %s", e)

    def note_persona_said(self, text: str) -> None:
        """Keep the persona's own words in the dialogue so the brain has context."""
        if self.history and self.history[-1]["role"] == "assistant":
            self.history[-1]["content"] += text
        else:
            self.history.append({"role": "assistant", "content": text})
        self._trim()

    def _trim(self) -> None:
        if len(self.history) > 24:
            self.history = self.history[-24:]

    async def on_user_utterance(self, text: str) -> str | None:
        """Returns the text the voice should say, or None."""
        if not self.model:
            return None
        self.history.append({"role": "user", "content": text})
        self._trim()
        async with self._busy:
            return await self._run(text)

    async def _run(self, user_text: str) -> str | None:
        assert self.model
        t0 = time.time()
        await self.on_event(BrainEvent("thinking", user_text))
        messages = [{"role": "system", "content": SYSTEM.format(persona=self.persona.render(), now=time.strftime("%A %Y-%m-%d %H:%M %Z"))}, *self.history]
        facts: list[str] = []
        for _round in range(5):
            try:
                resp = await self.client.chat(model=self.model, messages=messages, tools=TOOLS, options={"temperature": 0.3, "num_predict": 200}, keep_alive=KEEP_ALIVE, think=False)
            except TypeError:
                resp = await self.client.chat(model=self.model, messages=messages, tools=TOOLS, options={"temperature": 0.3, "num_predict": 200}, keep_alive=KEEP_ALIVE)
            except Exception as e:  # noqa: BLE001
                await self.on_event(BrainEvent("error", f"{type(e).__name__}: {e}"))
                return None
            msg = resp.message
            if msg.tool_calls:
                messages.append({"role": "assistant", "content": msg.content or "", "tool_calls": [tc.model_dump() for tc in msg.tool_calls]})
                for tc in msg.tool_calls:
                    name = tc.function.name
                    args = tc.function.arguments or {}
                    result = await self._tool(name, args)
                    await self.on_event(BrainEvent("tool", f"{name}({json.dumps(args)[:120]})", data={"result": result[:400]}))
                    if name in ("memory_search", "memory_recent", "web_search", "fetch_url", "now"):
                        facts.append(f"{name}: {result[:600]}")
                    messages.append({"role": "tool", "content": result, "tool_name": name})
                continue
            reply = (msg.content or "").strip()
            break
        else:
            reply = ""

        if not reply or reply.upper().startswith(NOOP):
            await self.on_event(BrainEvent("noop", f"{time.time() - t0:.1f}s"))
            return None
        reply = _spoken(reply)
        self.history.append({"role": "assistant", "content": reply})
        await self.on_event(BrainEvent("say", reply, data={"seconds": round(time.time() - t0, 1)}))
        if facts:
            # The persona only needs the distilled answer, not the raw tool output.
            brief = f"Facts you now know: {reply}"
            await self.on_event(BrainEvent("brief", brief))
        return reply

    # ---- tools -------------------------------------------------------------

    async def _tool(self, name: str, args: dict[str, Any]) -> str:
        try:
            if name == "now":
                return time.strftime("%A %Y-%m-%d %H:%M %Z")
            if name == "memory_search":
                if not (self.memory and self.memory.available):
                    return "memory unavailable (not signed in to scoria-api)"
                items = await self.memory.search(str(args.get("query", "")))
                return _fmt_memory(items)
            if name == "memory_recent":
                if not (self.memory and self.memory.available):
                    return "memory unavailable (not signed in to scoria-api)"
                items = await self.memory.recent(int(args.get("limit", 10)))
                return _fmt_memory(items)
            if name == "remember":
                if not (self.memory and self.memory.available):
                    return "memory unavailable (not signed in to scoria-api)"
                m = await self.memory.remember(str(args.get("title", "note")), args.get("body"))
                return f"saved {m.get('id')}"
            if name == "web_search":
                return await asyncio.get_running_loop().run_in_executor(None, _ddg, str(args.get("query", "")))
            if name == "fetch_url":
                return await self._fetch(str(args.get("url", "")))
            if name == "update_persona":
                instr = str(args.get("instruction", "")).strip()
                if instr:
                    self.persona.refine(instr)
                    await self.on_event(BrainEvent("persona", instr))
                    await self.on_persona_change(instr)
                return "persona updated"
            return f"unknown tool {name}"
        except Exception as e:  # noqa: BLE001
            log.exception("tool %s failed", name)
            return f"error: {type(e).__name__}: {e}"

    async def _fetch(self, url: str) -> str:
        r = await self._http.get(url)
        r.raise_for_status()
        try:
            import trafilatura

            text = trafilatura.extract(r.text) or ""
        except Exception:  # noqa: BLE001
            text = r.text
        return text[:4000] if text else "(no readable text)"

    async def close(self) -> None:
        await self._http.aclose()


def _ddg(query: str) -> str:
    from ddgs import DDGS

    rows = DDGS().text(query, max_results=5)
    if not rows:
        return "no results"
    return "\n".join(f"- {r.get('title')} — {r.get('href')}\n  {r.get('body')}" for r in rows)


def _fmt_memory(items: list[dict[str, Any]]) -> str:
    if not items:
        return "nothing found"
    out = []
    for m in items[:10]:
        place = (m.get("place") or {}).get("city")
        out.append(f"- [{m.get('occurred_at', '')[:10]}] {m.get('title') or m.get('kind')}" + (f" ({place})" if place else "") + (f": {m.get('body')[:200]}" if m.get("body") else ""))
    return "\n".join(out)


def _spoken(text: str) -> str:
    """Strip anything a speech model should not try to pronounce."""
    text = text.replace("**", "").replace("`", "").replace("#", "")
    lines = [ln.strip(" -*") for ln in text.splitlines() if ln.strip()]
    text = " ".join(lines)
    # Hard cap at two sentences; the persona fills in the small talk itself.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    text = " ".join(sentences[:2]).strip()
    return text[:400]
