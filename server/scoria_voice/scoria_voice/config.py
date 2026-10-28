from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _read_token(env_name: str, file_env: str, default_file: str | None) -> str | None:
    if v := os.environ.get(env_name):
        return v.strip()
    path = os.environ.get(file_env) or default_file
    if path and Path(path).expanduser().exists():
        return Path(path).expanduser().read_text().strip()
    return None


@dataclass
class Config:
    host: str = "0.0.0.0"
    port: int = 8998
    ssl_dir: str | None = None

    # PersonaPlex
    hf_repo: str = "nvidia/personaplex-7b-v1"
    hf_token: str | None = None
    device: str = "cuda"  # ROCm shows up as cuda in torch
    cpu_offload: bool = False
    default_voice: str = "NATF2.pt"
    autoload: bool = False  # load weights at startup instead of on toggle

    # Brain: Parasail for thinking when a key is present; Ollama otherwise.
    brain_provider: str = "auto"  # auto | parasail | ollama
    ollama_url: str = "http://127.0.0.1:11434"
    brain_model: str | None = None  # None -> pick the best present Ollama model
    brain_candidates: list[str] = field(
        default_factory=lambda: [
            "gpt-oss:120b",
            "qwen3.5:122b",
            "gpt-oss:20b",
            "qwen3.5:32b",
            "qwen3.5:9b",
            "llama3.2:3b",
        ]
    )
    brain_enabled: bool = True
    parasail_api_key: str | None = None
    parasail_base_url: str = "https://api.parasail.io/v1"
    parasail_model: str = "parasail-glm-53-flash"

    # STT
    whisper_model: str = "distil-large-v3"
    whisper_device: str = "cpu"  # CTranslate2 has no ROCm backend
    whisper_compute: str = "int8"
    stt_enabled: bool = True

    # Scoria memory
    scoria_api_url: str | None = "http://127.0.0.1:8090"
    scoria_handle: str | None = None
    scoria_password: str | None = None

    @classmethod
    def from_env(cls) -> "Config":
        e = os.environ
        return cls(
            host=e.get("VOICE_HOST", "0.0.0.0"),
            port=int(e.get("VOICE_PORT", "8998")),
            ssl_dir=e.get("VOICE_SSL_DIR"),
            hf_repo=e.get("PERSONAPLEX_REPO", "nvidia/personaplex-7b-v1"),
            hf_token=_read_token("HF_TOKEN", "HF_TOKEN_FILE", None),
            device=e.get("VOICE_DEVICE", "cuda"),
            cpu_offload=e.get("VOICE_CPU_OFFLOAD", "0") == "1",
            default_voice=e.get("VOICE_DEFAULT_VOICE", "NATF2.pt"),
            autoload=e.get("VOICE_AUTOLOAD", "0") == "1",
            brain_provider=(e.get("BRAIN_PROVIDER") or e.get("SCORIA_CHAT_PROVIDER") or "auto").lower(),
            ollama_url=e.get("OLLAMA_URL", "http://127.0.0.1:11434"),
            brain_model=e.get("BRAIN_MODEL") or None,
            brain_enabled=e.get("BRAIN_ENABLED", "1") == "1",
            parasail_api_key=_read_token("PARASAIL_API_KEY", "PARASAIL_API_KEY_FILE", None),
            parasail_base_url=e.get("PARASAIL_BASE_URL", "https://api.parasail.io/v1"),
            parasail_model=e.get("PARASAIL_MODEL") or e.get("SCORIA_PARASAIL_CHAT_MODEL") or "parasail-glm-53-flash",
            whisper_model=e.get("WHISPER_MODEL", "distil-large-v3"),
            whisper_device=e.get("WHISPER_DEVICE", "cpu"),
            whisper_compute=e.get("WHISPER_COMPUTE", "int8"),
            stt_enabled=e.get("STT_ENABLED", "1") == "1",
            scoria_api_url=e.get("SCORIA_API_URL", "http://127.0.0.1:8090") or None,
            scoria_handle=e.get("SCORIA_HANDLE") or None,
            scoria_password=e.get("SCORIA_PASSWORD") or None,
        )
