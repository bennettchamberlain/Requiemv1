"""PersonaPlex lifecycle: the toggle.

`Engine.load()` pulls weights (HF cache), builds Mimi x2, the LM and the
hooked generator, and warms up. `Engine.unload()` drops everything and frees
the GPU. Sessions hold the engine while a websocket is open.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import os
import tarfile
import time
from dataclasses import dataclass
from pathlib import Path

import sentencepiece
import torch
from huggingface_hub import hf_hub_download
from moshi.models import loaders
from moshi.models.compression import MimiModel

from .hooked_lmgen import HookedLMGen, TextPolicy

log = logging.getLogger("scoria.voice.engine")


def _hf_download(repo: str, name: str, token: str | None) -> str:
    return hf_hub_download(repo, name, token=token)


@dataclass
class EngineStatus:
    loaded: bool
    loading: bool
    device: str
    voice: str | None
    load_seconds: float | None
    error: str | None
    gpu_mem_gb: float | None


class Engine:
    def __init__(self, cfg):
        self.cfg = cfg
        self.device = torch.device(cfg.device if torch.cuda.is_available() else "cpu")
        self.mimi: MimiModel | None = None
        self.other_mimi: MimiModel | None = None
        self.text_tokenizer: sentencepiece.SentencePieceProcessor | None = None
        self.lm_gen: HookedLMGen | None = None
        self.policy: TextPolicy | None = None
        self.frame_size: int = 1920
        self.voice_prompt_dir: str | None = None
        self.static_dir: str | None = None
        self.lock = asyncio.Lock()  # one live session at a time, as upstream
        self._loading = False
        self._error: str | None = None
        self._load_seconds: float | None = None
        self.current_voice: str | None = None

    # ---- assets ----------------------------------------------------------

    def ensure_assets(self) -> None:
        """Tokenizer, voices and web client are small; fetch them eagerly."""
        tok = _hf_download(self.cfg.hf_repo, loaders.TEXT_TOKENIZER_NAME, self.cfg.hf_token)
        if self.text_tokenizer is None:
            self.text_tokenizer = sentencepiece.SentencePieceProcessor(tok)  # type: ignore
        voices_tgz = Path(_hf_download(self.cfg.hf_repo, "voices.tgz", self.cfg.hf_token))
        voices = voices_tgz.parent / "voices"
        if not voices.exists():
            with tarfile.open(voices_tgz, "r:gz") as tar:
                tar.extractall(path=voices_tgz.parent)
        self.voice_prompt_dir = str(voices)
        dist_tgz = Path(_hf_download(self.cfg.hf_repo, "dist.tgz", self.cfg.hf_token))
        dist = dist_tgz.parent / "dist"
        if not dist.exists():
            with tarfile.open(dist_tgz, "r:gz") as tar:
                tar.extractall(path=dist_tgz.parent)
        self.static_dir = str(dist)

    def voices(self) -> list[str]:
        if not self.voice_prompt_dir:
            return []
        return sorted(f for f in os.listdir(self.voice_prompt_dir) if f.endswith(".pt"))

    # ---- lifecycle -------------------------------------------------------

    @property
    def loaded(self) -> bool:
        return self.lm_gen is not None

    def status(self) -> EngineStatus:
        mem = None
        if torch.cuda.is_available():
            try:
                mem = torch.cuda.memory_allocated() / 1e9
            except Exception:  # noqa: BLE001
                mem = None
        return EngineStatus(
            loaded=self.loaded,
            loading=self._loading,
            device=str(self.device),
            voice=self.current_voice,
            load_seconds=self._load_seconds,
            error=self._error,
            gpu_mem_gb=mem,
        )

    async def load(self) -> None:
        if self.loaded or self._loading:
            return
        self._loading = True
        self._error = None
        try:
            await asyncio.get_running_loop().run_in_executor(None, self._load_sync)
        except Exception as e:  # noqa: BLE001
            self._error = f"{type(e).__name__}: {e}"
            log.exception("engine load failed")
            self._teardown()
            raise
        finally:
            self._loading = False

    def _load_sync(self) -> None:
        t0 = time.time()
        torch.set_grad_enabled(False)  # inference-only process (upstream wraps each session in no_grad)
        self.ensure_assets()
        log.info("loading mimi")
        mimi_w = _hf_download(self.cfg.hf_repo, loaders.MIMI_NAME, self.cfg.hf_token)
        self.mimi = loaders.get_mimi(mimi_w, self.device)
        self.other_mimi = loaders.get_mimi(mimi_w, self.device)
        self.frame_size = int(self.mimi.sample_rate / self.mimi.frame_rate)
        log.info("loading moshi (this is the 16.7 GB file)")
        lm_w = _hf_download(self.cfg.hf_repo, loaders.MOSHI_NAME, self.cfg.hf_token)
        lm = loaders.get_moshi_lm(lm_w, device=self.device, cpu_offload=self.cfg.cpu_offload)
        lm.eval()
        self.lm_gen = HookedLMGen(
            lm,
            audio_silence_frame_cnt=int(0.5 * self.mimi.frame_rate),
            sample_rate=self.mimi.sample_rate,
            device=self.device,
            frame_rate=self.mimi.frame_rate,
        )
        self.policy = TextPolicy(tokenizer=self.text_tokenizer)
        self.lm_gen.policy = self.policy
        self.mimi.streaming_forever(1)
        self.other_mimi.streaming_forever(1)
        self.lm_gen.streaming_forever(1)
        log.info("warming up")
        # One frame is enough to compile kernels; extra frames used to add
        # seconds to every cold start.
        self._warmup(frames=1)
        self._load_seconds = time.time() - t0
        log.info("engine ready in %.1fs on %s", self._load_seconds, self.device)

    def _warmup(self, frames: int = 1) -> None:
        assert self.mimi and self.other_mimi and self.lm_gen
        for _ in range(max(1, frames)):
            chunk = torch.zeros(1, 1, self.frame_size, dtype=torch.float32, device=self.device)
            codes = self.mimi.encode(chunk)
            _ = self.other_mimi.encode(chunk)
            for c in range(codes.shape[-1]):
                tokens = self.lm_gen.step(codes[:, :, c: c + 1])
                if tokens is None:
                    continue
                _ = self.mimi.decode(tokens[:, 1:9])
                _ = self.other_mimi.decode(tokens[:, 1:9])
        if self.device.type == "cuda":
            torch.cuda.synchronize()

    async def unload(self) -> None:
        async with self.lock:  # waits for a live session to finish
            self._teardown()

    def _teardown(self) -> None:
        self.lm_gen = None
        self.policy = None
        self.mimi = None
        self.other_mimi = None
        self.current_voice = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        log.info("engine unloaded")

    # ---- per-session helpers --------------------------------------------

    def select_voice(self, name: str | None) -> str:
        assert self.lm_gen and self.voice_prompt_dir
        name = name or self.cfg.default_voice
        path = os.path.join(self.voice_prompt_dir, name)
        if not os.path.exists(path):
            raise FileNotFoundError(f"voice prompt {name!r} not in {self.voice_prompt_dir}")
        if self.lm_gen.voice_prompt != path:
            if path.endswith(".pt"):
                self.lm_gen.load_voice_prompt_embeddings(path)
            else:
                self.lm_gen.load_voice_prompt(path)
        self.current_voice = name
        return path

    def encode_system(self, text: str) -> list[int]:
        assert self.text_tokenizer
        cleaned = text.strip()
        if not (cleaned.startswith("<system>") and cleaned.endswith("<system>")):
            cleaned = f"<system> {cleaned} <system>"
        return self.text_tokenizer.encode(cleaned)
