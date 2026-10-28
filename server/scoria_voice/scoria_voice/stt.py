"""Ears for the brain: segment the user's microphone stream and transcribe it.

PersonaPlex hears the user directly, but it never emits what the user said.
The brain needs text, so we run a second recognizer on the same PCM. Energy
VAD with hangover cuts utterances; faster-whisper (CTranslate2, CPU int8 —
there is no ROCm backend) transcribes each in a worker thread.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import numpy as np

log = logging.getLogger("scoria.voice.stt")

OnUtterance = Callable[[str, float, float], Awaitable[None]]  # text, start_ts, end_ts


@dataclass
class VadParams:
    frame_ms: int = 80
    start_ms: int = 240       # speech this long starts an utterance
    end_ms: int = 700         # silence this long ends it
    max_ms: int = 20000       # hard cut
    floor: float = 0.004      # absolute RMS floor
    ratio: float = 3.0        # speech if rms > ratio * noise estimate


class Transcriber:
    def __init__(self, model: str, device: str = "cpu", compute: str = "int8"):
        from faster_whisper import WhisperModel  # heavy import, keep local

        t0 = time.time()
        self.model = WhisperModel(model, device=device, compute_type=compute)
        log.info("whisper %s ready in %.1fs", model, time.time() - t0)

    def transcribe(self, pcm16k: np.ndarray) -> str:
        segments, _info = self.model.transcribe(
            pcm16k, language="en", beam_size=1, vad_filter=False, condition_on_previous_text=False,
        )
        return " ".join(s.text.strip() for s in segments).strip()


def resample_linear(pcm: np.ndarray, src: int, dst: int) -> np.ndarray:
    if src == dst:
        return pcm.astype(np.float32)
    n_out = int(round(len(pcm) * dst / src))
    x_old = np.linspace(0.0, 1.0, num=len(pcm), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, pcm).astype(np.float32)


class UtteranceSegmenter:
    """Feed 80 ms PCM frames; get utterances back as transcripts."""

    def __init__(self, transcriber: Transcriber | None, sample_rate: int, on_utterance: OnUtterance, params: VadParams | None = None):
        self.t = transcriber
        self.sr = sample_rate
        self.on_utterance = on_utterance
        self.p = params or VadParams()
        self._buf: list[np.ndarray] = []
        self._pre: list[np.ndarray] = []   # ring of pre-roll frames
        self._in_speech = False
        self._speech_ms = 0
        self._silence_ms = 0
        self._noise = 0.01
        self._start_ts = 0.0
        self.speaking = False  # exported: is the user talking right now
        self._tasks: set[asyncio.Task] = set()

    def feed(self, frame: np.ndarray) -> None:
        rms = float(np.sqrt(np.mean(frame.astype(np.float32) ** 2)) + 1e-9)
        thresh = max(self.p.floor, self._noise * self.p.ratio)
        is_speech = rms > thresh
        if not is_speech:
            self._noise = 0.95 * self._noise + 0.05 * rms  # track noise floor during silence

        if not self._in_speech:
            self._pre.append(frame)
            if len(self._pre) > 4:
                self._pre.pop(0)
            if is_speech:
                self._speech_ms += self.p.frame_ms
                if self._speech_ms >= self.p.start_ms:
                    self._in_speech = True
                    self.speaking = True
                    self._start_ts = time.time() - self._speech_ms / 1000
                    self._buf = list(self._pre)
                    self._silence_ms = 0
            else:
                self._speech_ms = 0
            return

        self._buf.append(frame)
        if is_speech:
            self._silence_ms = 0
        else:
            self._silence_ms += self.p.frame_ms
        total_ms = len(self._buf) * self.p.frame_ms
        if self._silence_ms >= self.p.end_ms or total_ms >= self.p.max_ms:
            self._finish()

    def _finish(self) -> None:
        pcm = np.concatenate(self._buf) if self._buf else np.zeros(0, dtype=np.float32)
        self._buf = []
        self._in_speech = False
        self.speaking = False
        self._speech_ms = 0
        self._silence_ms = 0
        start, end = self._start_ts, time.time()
        if self.t is None or len(pcm) < self.sr * 0.3:
            return
        task = asyncio.get_running_loop().create_task(self._transcribe(pcm, start, end))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _transcribe(self, pcm: np.ndarray, start: float, end: float) -> None:
        loop = asyncio.get_running_loop()
        pcm16 = resample_linear(pcm, self.sr, 16000)
        try:
            text = await loop.run_in_executor(None, self.t.transcribe, pcm16)
        except Exception:  # noqa: BLE001
            log.exception("transcription failed")
            return
        if text:
            await self.on_utterance(text, start, end)

    def flush(self) -> None:
        if self._in_speech:
            self._finish()
