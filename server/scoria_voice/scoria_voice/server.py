"""HTTP/WS server: the stock PersonaPlex client at /, our console at /console,
and a control API for the toggle, the meta prompt, and manual say/brief."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl

import torch
import subprocess
import time
from pathlib import Path

from aiohttp import web

from .brain import Brain
from .config import Config
from .engine import Engine
from .memory_client import MemoryClient
from .persona import PersonaStore
from .session import Session
from .stt import Transcriber

log = logging.getLogger("scoria.voice")
CONSOLE_HTML = Path(__file__).with_name("console.html")


class App:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.engine = Engine(cfg)
        self.store = PersonaStore(Path(os.environ.get("VOICE_STATE_DIR", "~/.local/state/scoria-voice")).expanduser() / "persona.json")
        self.persona = self.store.persona
        self.memory = MemoryClient(cfg.scoria_api_url, cfg.scoria_handle, cfg.scoria_password) if cfg.scoria_api_url else None
        self.brain: Brain | None = None
        self.transcriber: Transcriber | None = None
        self._stt_task: asyncio.Future | None = None
        self.session: Session | None = None
        self.subscribers: set[asyncio.Queue] = set()
        self.recent_events: list[dict] = []

    # ---- events ---------------------------------------------------------------

    async def broadcast(self, payload: dict) -> None:
        self.recent_events.append(payload)
        self.recent_events = self.recent_events[-200:]
        for q in list(self.subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass
        # Brain/persona events originate outside the session; mirror them to the live client.
        if payload.get("type") in ("brain", "persona") and self.session is not None and not self.session.close:
            await self.session.send_meta(payload)

    async def _persona_changed(self, instruction: str) -> None:
        self.store.save()
        if self.session is not None and not self.session.close:
            self.session.inject_system(instruction)
        await self.broadcast({"type": "persona", "rendered": self.persona.render(), "ts": time.time()})

    # ---- startup --------------------------------------------------------------

    async def startup(self, app: web.Application) -> None:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, self.engine.ensure_assets)
        if self.memory is not None:
            ok = await self.memory.sign_in()
            log.info("scoria memory: %s", "signed in" if ok else "unavailable")
        if self.cfg.brain_enabled:
            self.brain = Brain(self.cfg, self.memory, self.persona, self.broadcast_brain, self._persona_changed)
            await self.brain.start()
        if self.cfg.autoload:
            asyncio.create_task(self.load_all())

    async def ensure_stt(self) -> None:
        """Load whisper on first use (it may need a ~1.5 GB download); never blocks the port."""
        if not self.cfg.stt_enabled or self.transcriber is not None:
            return
        if self._stt_task is None:
            loop = asyncio.get_running_loop()
            self._stt_task = loop.run_in_executor(
                None, lambda: Transcriber(self.cfg.whisper_model, self.cfg.whisper_device, self.cfg.whisper_compute)
            )
        try:
            self.transcriber = await self._stt_task
        except Exception:  # noqa: BLE001
            log.exception("whisper unavailable; STT disabled")
            self._stt_task = None
            self.cfg.stt_enabled = False

    async def load_all(self) -> None:
        """Engine toggle ON: PersonaPlex weights and the STT model together."""
        await asyncio.gather(self.engine.load(), self.ensure_stt())

    async def broadcast_brain(self, ev) -> None:
        await self.broadcast({"type": "brain", **ev.to_dict()})

    # ---- handlers -------------------------------------------------------------

    def status_dict(self) -> dict:
        st = self.engine.status()
        return {
            "engine": st.__dict__,
            "brain": {
                "enabled": self.brain is not None,
                "provider": self.brain.provider if self.brain else None,
                "model": self.brain.model if self.brain else None,
                "ollama": self.cfg.ollama_url,
                "parasail": bool(self.cfg.parasail_api_key),
            },
            "stt": {"enabled": self.transcriber is not None, "model": self.cfg.whisper_model},
            "memory": {"available": bool(self.memory and self.memory.available), "person": (self.memory.person or {}).get("handle") if self.memory else None},
            "session": None if self.session is None or self.session.close else {"started_at": self.session.started_at, "turns": len(self.session.transcript), "injected_frames": self.session.injected_frames},
            "persona": self.persona.to_dict(),
            "voices": self.engine.voices(),
        }

    async def h_status(self, _):
        return web.json_response(self.status_dict())

    async def h_engine(self, request):
        body = await request.json()
        on = bool(body.get("on", True))
        if on:
            try:
                await self.load_all()
            except Exception as e:  # noqa: BLE001
                return web.json_response({"error": str(e)}, status=500)
        else:
            if self.session is not None and not self.session.close:
                self.session.close = True
            await self.engine.unload()
        return web.json_response(self.status_dict())

    async def h_persona_get(self, _):
        return web.json_response(self.persona.to_dict())

    async def h_persona_put(self, request):
        body = await request.json()
        if "refine" in body:
            self.persona.refine(str(body["refine"]))
            await self._persona_changed(str(body["refine"]))
        else:
            self.persona.replace(base=body.get("base"), refinements=body.get("refinements"), voice=body.get("voice"))
            self.store.save()
            if body.get("inject", True) and self.session is not None and not self.session.close:
                self.session.inject_system(self.persona.render())
            await self.broadcast({"type": "persona", "rendered": self.persona.render(), "ts": time.time()})
        return web.json_response(self.persona.to_dict())

    async def h_say(self, request):
        body = await request.json()
        if self.session is None or self.session.close:
            return web.json_response({"error": "no live session"}, status=409)
        n = self.session.say(str(body.get("text", "")), interrupt=bool(body.get("interrupt", False)))
        return web.json_response({"queued_tokens": n})

    async def h_brief(self, request):
        body = await request.json()
        if self.session is None or self.session.close:
            return web.json_response({"error": "no live session"}, status=409)
        self.session.inject_system(str(body.get("text", "")))
        return web.json_response({"queued": len(self.session.pending_system)})

    async def h_mute(self, request):
        body = await request.json()
        if self.session is None or self.session.close:
            return web.json_response({"error": "no live session"}, status=409)
        self.session.set_mute(bool(body.get("mute", True)), by_user=True)
        return web.json_response({"mute": bool(body.get("mute", True))})

    async def h_ask(self, request):
        """Typed input to the brain (same path as a transcribed utterance)."""
        body = await request.json()
        text = str(body.get("text", "")).strip()
        if not text:
            return web.json_response({"error": "text required"}, status=400)
        if self.session is not None and not self.session.close:
            await self.session._on_user_utterance(text, time.time(), time.time())  # noqa: SLF001
            return web.json_response({"ok": True, "live": True})
        if self.brain is None:
            return web.json_response({"error": "brain disabled"}, status=503)
        reply = await self.brain.on_user_utterance(text)
        return web.json_response({"ok": True, "live": False, "reply": reply})

    async def h_events(self, request):
        resp = web.StreamResponse(headers={"content-type": "text/event-stream", "cache-control": "no-cache"})
        await resp.prepare(request)
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self.subscribers.add(q)
        try:
            for ev in self.recent_events[-50:]:
                await resp.write(f"data: {json.dumps(ev)}\n\n".encode())
            while True:
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15)
                    await resp.write(f"data: {json.dumps(ev)}\n\n".encode())
                except asyncio.TimeoutError:
                    await resp.write(b": keepalive\n\n")
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        finally:
            self.subscribers.discard(q)
        return resp

    async def h_chat(self, request):
        if not self.engine.loaded:
            if self.cfg.autoload or request.query.get("autoload") == "1":
                await self.engine.load()
            else:
                ws = web.WebSocketResponse()
                await ws.prepare(request)
                await ws.send_bytes(b"\x05" + b"voice engine is off; toggle it on in /console")
                await ws.close()
                return ws
        if self.session is not None and not self.session.close:
            self.session.close = True
        self.session = Session(self.engine, self.persona, self.brain, self.transcriber, self.broadcast, self.memory)
        return await self.session.run(request)

    async def h_console(self, _):
        return web.Response(text=CONSOLE_HTML.read_text(), content_type="text/html")

    async def h_root(self, _):
        if self.engine.static_dir:
            return web.FileResponse(Path(self.engine.static_dir) / "index.html")
        raise web.HTTPFound("/console")

    def build(self) -> web.Application:
        app = web.Application()
        app.on_startup.append(self.startup)
        r = app.router
        r.add_get("/api/status", self.h_status)
        r.add_post("/api/engine", self.h_engine)
        r.add_get("/api/persona", self.h_persona_get)
        r.add_put("/api/persona", self.h_persona_put)
        r.add_post("/api/say", self.h_say)
        r.add_post("/api/brief", self.h_brief)
        r.add_post("/api/mute", self.h_mute)
        r.add_post("/api/ask", self.h_ask)
        r.add_get("/api/events", self.h_events)
        r.add_get("/api/chat", self.h_chat)
        r.add_get("/console", self.h_console)
        r.add_get("/", self.h_root)
        if self.engine.static_dir:
            r.add_static("/", path=self.engine.static_dir, name="static")
        return app


def _ssl_context(ssl_dir: str) -> ssl.SSLContext:
    d = Path(ssl_dir)
    d.mkdir(parents=True, exist_ok=True)
    cert, key = d / "cert.pem", d / "key.pem"
    if not (cert.exists() and key.exists()):
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(cert), "-days", "365", "-subj", "/CN=scoria-voice"],
            check=True, capture_output=True,
        )
    ctx = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    ctx.load_cert_chain(str(cert), str(key))
    return ctx


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    for noisy in ("httpx", "httpx2", "httpcore", "urllib3", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    torch.set_grad_enabled(False)  # thread-local: the event-loop thread runs all inference steps
    cfg = Config.from_env()
    app = App(cfg)
    # ensure_assets needs the static dir before routes are added
    app.engine.ensure_assets()
    web_app = app.build()
    ctx = _ssl_context(cfg.ssl_dir) if cfg.ssl_dir else None
    scheme = "https" if ctx else "http"
    log.info("scoria-voice on %s://%s:%d  (console at /console)", scheme, cfg.host, cfg.port)
    web.run_app(web_app, host=cfg.host, port=cfg.port, ssl_context=ctx, print=None)


if __name__ == "__main__":
    main()
