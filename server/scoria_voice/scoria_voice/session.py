"""One live full-duplex conversation over the PersonaPlex websocket protocol.

Wire format (unchanged from upstream so the stock web client works):
  server -> client: 0x00 handshake, 0x01 opus audio, 0x02 text piece the
  persona is saying, 0x04 JSON metadata (ours: user transcript, brain events).
  client -> server: 0x01 opus audio.

Around the upstream loop we add: STT on the user PCM, the brain, forced
speech through the text policy, and quiet-moment `<system>` injection.
"""

from __future__ import annotations

import asyncio
import json
import os
import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable

import aiohttp
import numpy as np
import sphn
import torch
from aiohttp import web

from .brain import Brain, BrainEvent
from .engine import Engine
from .persona import Persona
from .stt import Transcriber, UtteranceSegmenter

log = logging.getLogger("scoria.voice.session")

Broadcast = Callable[[dict], Awaitable[None]]


class Session:
    def __init__(self, engine: Engine, persona: Persona, brain: Brain | None, transcriber: Transcriber | None, broadcast: Broadcast, memory=None):
        self.engine = engine
        self.persona = persona
        self.brain = brain
        self.transcriber = transcriber
        self.broadcast = broadcast
        self.memory = memory
        self.ws: web.WebSocketResponse | None = None
        self.close = False
        self.pending_system: deque[str] = deque()
        self._system_wait_frames = 0
        self.transcript: list[tuple[str, str]] = []  # (who, text)
        self._persona_text_buf = ""
        self.started_at = time.time()
        self.injected_frames = 0
        self.user_muted = False
        self.hold_ms = int(os.environ.get("VOICE_HOLD_MS", "1200"))  # persona pause while the brain thinks (0 = off)

    # ---- public controls (from console / brain) -----------------------------

    def say(self, text: str, interrupt: bool = False) -> int:
        assert self.engine.policy
        n = self.engine.policy.say(text, interrupt=interrupt)
        self.transcript.append(("brain", text))
        return n

    def inject_system(self, text: str) -> None:
        self.pending_system.append(text)

    def set_mute(self, mute: bool, by_user: bool = False) -> None:
        assert self.engine.policy
        if by_user:
            self.user_muted = mute
        self.engine.policy.mute = mute

    # ---- events -------------------------------------------------------------

    async def _emit(self, payload: dict) -> None:
        payload.setdefault("ts", time.time())
        await self.broadcast(payload)
        await self.send_meta(payload)

    async def send_meta(self, payload: dict) -> None:
        """0x04 JSON frame to the connected client only (no SSE fan-out)."""
        if self.ws is not None and not self.ws.closed:
            try:
                await self.ws.send_bytes(b"\x04" + json.dumps(payload).encode())
            except ConnectionResetError:
                pass

    async def _on_brain_event(self, ev: BrainEvent) -> None:
        await self._emit({"type": "brain", **ev.to_dict()})
        if ev.kind == "brief":
            self.inject_system(ev.text)

    async def _on_persona_change(self, instruction: str) -> None:
        self.inject_system(instruction)
        await self._emit({"type": "persona", "rendered": self.persona.render()})

    async def _on_user_utterance(self, text: str, start: float, end: float) -> None:
        self.transcript.append(("user", text))
        await self._emit({"type": "user_text", "text": text, "start": start, "end": end})
        if self.brain is None:
            return
        # Hold the persona's tongue briefly while the brain decides, so it does not blurt a
        # guess (a made-up date, a wrong name) that the brain is about to correct. Capped so
        # a slow brain never turns into an awkward silence; a user-set mute is left alone.
        hold = self.hold_ms / 1000 if self.hold_ms > 0 and not self.user_muted else 0
        if hold:
            self.set_mute(True)
            release = asyncio.get_running_loop().call_later(hold, self._release_hold)
        try:
            reply = await self.brain.on_user_utterance(text)
        finally:
            if hold:
                release.cancel()
                self._release_hold()
        if reply and not self.close:
            self.say(reply, interrupt=True)

    def _release_hold(self) -> None:
        if not self.user_muted and self.engine.policy is not None:
            self.engine.policy.mute = False

    # ---- the loop -------------------------------------------------------------

    async def run(self, request: web.Request) -> web.WebSocketResponse:
        eng = self.engine
        assert eng.lm_gen and eng.mimi and eng.other_mimi and eng.policy and eng.text_tokenizer
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.ws = ws
        peer = request.remote
        log.info("session from %s", peer)

        text_prompt = request.query.get("text_prompt", "").strip() or self.persona.render()
        voice = request.query.get("voice_prompt", "").strip() or self.persona.voice
        eng.select_voice(voice)
        eng.lm_gen.text_prompt_tokens = eng.encode_system(text_prompt)
        eng.policy.clear()
        eng.policy.mute = False
        if self.brain is not None:
            self.brain.persona = self.persona

        segmenter = UtteranceSegmenter(self.transcriber, eng.mimi.sample_rate, self._on_user_utterance) if self.transcriber else None
        frame_size = eng.frame_size
        opus_writer = sphn.OpusStreamWriter(eng.mimi.sample_rate)
        opus_reader = sphn.OpusStreamReader(eng.mimi.sample_rate)

        async def recv_loop():
            try:
                async for message in ws:
                    if message.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSE):
                        break
                    if message.type != aiohttp.WSMsgType.BINARY or not message.data:
                        continue
                    kind = message.data[0]
                    if kind == 1:
                        opus_reader.append_bytes(message.data[1:])
                    elif kind == 2:  # text from client: treat as typed user input to the brain
                        text = message.data[1:].decode("utf8", "ignore").strip()
                        if text:
                            asyncio.create_task(self._on_user_utterance(text, time.time(), time.time()))
            finally:
                self.close = True

        def maybe_inject_system() -> None:
            """Write queued <system> blocks when nobody is talking."""
            if not self.pending_system:
                self._system_wait_frames = 0
                return
            quiet_model = eng.policy.frames_since_word >= 6 and eng.policy.pending == 0
            quiet_user = segmenter is None or not segmenter.speaking
            self._system_wait_frames += 1
            if (quiet_model and quiet_user) or self._system_wait_frames > 75:  # 6 s cap
                text = self.pending_system.popleft()
                n = eng.lm_gen.inject_system_text(eng.encode_system(text))
                self.injected_frames += n
                self._system_wait_frames = 0
                log.info("injected system block (%d steps): %s", n, text[:80])

        async def opus_loop():
            all_pcm = None
            while not self.close:
                await asyncio.sleep(0.001)
                pcm = opus_reader.read_pcm()
                if pcm.shape[-1] == 0:
                    continue
                all_pcm = pcm if all_pcm is None else np.concatenate((all_pcm, pcm))
                while all_pcm.shape[-1] >= frame_size:
                    chunk_np = all_pcm[:frame_size]
                    all_pcm = all_pcm[frame_size:]
                    if segmenter is not None:
                        segmenter.feed(chunk_np)
                    maybe_inject_system()
                    chunk = torch.from_numpy(chunk_np).to(device=eng.device)[None, None]
                    codes = eng.mimi.encode(chunk)
                    _ = eng.other_mimi.encode(chunk)
                    for c in range(codes.shape[-1]):
                        tokens = eng.lm_gen.step(codes[:, :, c: c + 1])
                        if tokens is None:
                            continue
                        main_pcm = eng.mimi.decode(tokens[:, 1:9])
                        _ = eng.other_mimi.decode(tokens[:, 1:9])
                        opus_writer.append_pcm(main_pcm[0, 0].cpu().numpy())
                        text_token = tokens[0, 0, 0].item()
                        if text_token not in (0, 3):
                            piece = eng.text_tokenizer.id_to_piece(text_token).replace("▁", " ")
                            self._persona_text_buf += piece
                            if self.brain is not None:
                                self.brain.note_persona_said(piece)
                            await ws.send_bytes(b"\x02" + piece.encode("utf8"))
                            if piece.endswith((".", "?", "!")) and len(self._persona_text_buf) > 20:
                                await self.broadcast({"type": "persona_text", "text": self._persona_text_buf.strip(), "ts": time.time()})
                                self.transcript.append(("persona", self._persona_text_buf.strip()))
                                self._persona_text_buf = ""

        async def send_loop():
            while not self.close:
                await asyncio.sleep(0.001)
                msg = opus_writer.read_bytes()
                if msg:
                    await ws.send_bytes(b"\x01" + msg)

        async def is_alive():
            if self.close or ws.closed:
                return False
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=0.01)
                if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    return False
            except asyncio.TimeoutError:
                return True
            except aiohttp.ClientConnectionError:
                return False
            return True

        async with eng.lock:
            eng.mimi.reset_streaming()
            eng.other_mimi.reset_streaming()
            eng.lm_gen.reset_streaming()
            await self._emit({"type": "session", "state": "priming", "voice": voice, "text_prompt": text_prompt})
            await eng.lm_gen.step_system_prompts_async(eng.mimi, is_alive=is_alive)
            eng.mimi.reset_streaming()
            if await is_alive():
                await ws.send_bytes(b"\x00")
                await self._emit({"type": "session", "state": "live"})
                tasks = [asyncio.create_task(recv_loop()), asyncio.create_task(opus_loop()), asyncio.create_task(send_loop())]
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in done:
                    if t.exception():
                        log.error("session task failed: %r", t.exception())
                self.close = True
                for t in pending:
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):  # noqa: BLE001
                        pass
                await ws.close()
            if segmenter is not None:
                segmenter.flush()
        await self._emit({"type": "session", "state": "closed", "seconds": round(time.time() - self.started_at)})
        await self._persist()
        return ws

    async def _persist(self) -> None:
        if not (self.memory and self.memory.available) or len(self.transcript) < 2:
            return
        body = "\n".join(f"{who}: {text}" for who, text in self.transcript)
        try:
            await self.memory.remember(
                title=f"Voice conversation {time.strftime('%Y-%m-%d %H:%M')}",
                body=body[:8000],
                kind="conversation",
                source="voice",
            )
        except Exception:  # noqa: BLE001
            log.exception("could not persist transcript")
