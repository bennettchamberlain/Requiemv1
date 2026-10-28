# scoria-voice

Full-duplex voice for Scoria. [PersonaPlex](https://github.com/NVIDIA/personaplex)
(NVIDIA's Moshi fork) is the mouth and the ears. Thinking prefers Parasail
when `PARASAIL_API_KEY` is set, then a local Ollama model. Scoria memory and
the web stay as tools. Flutter chat speaks on the device (mic + TTS) and
renders generative UI; this sidecar is the room speaker when the engine is on.

```
mic ──opus──▶ session ──▶ Mimi ──▶ PersonaPlex LM ──▶ Mimi ──opus──▶ speaker
                 │                      ▲   ▲
                 ├─ VAD + whisper ──▶ brain │   │
                 │   (user transcript)  │   │   └── say: forced text tokens, model pacing
                 │                      ▼   └────── brief / meta prompt: <system> block
                 └────────────────── tools: memory_search · remember · web_search · fetch_url · now · update_persona
```

## How the brain gets a word in

PersonaPlex samples its next text token *before* generating audio for the
frame. `HookedLMGen` lets a `TextPolicy` replace that token:

* **say** — the brain's answer is queued as tokens. A new word is only forced
  when the model itself decided to say a word, so timing, prosody and
  turn-taking stay the model's; the words become ours. Continuation pieces are
  forced at once; after `patience` frames of silence a word is forced anyway.
* **brief / meta prompt** — a `<system> … <system>` block is stepped into the
  stream over silent frames, exactly how the role prompt is loaded at start.
  Done in quiet moments (model and user both silent), capped at 6 s wait. The
  silent frames are not sent to the client, so playback does not lag.

The meta prompt is persisted (`~/.local/state/scoria-voice/persona.json`) and
every refinement — from the console or from the user saying "speak slower" —
is injected live.

## Run

```sh
cd server/scoria_voice
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch torchaudio --index-url https://download.pytorch.org/whl/rocm7.2
printf 'torch>=2.14\nhuggingface-hub>=0.30\n' > /tmp/overrides.txt
uv pip install --python .venv/bin/python --override /tmp/overrides.txt -e .   # moshi-personaplex pins torch 2.4 / hf-hub 0.24; override

export HF_TOKEN_FILE=~/devel/mynamehf.txt              # or HF_TOKEN=…
export SCORIA_HANDLE=admin SCORIA_PASSWORD=…           # memory tools (scoria-api on :8090)
export PARASAIL_API_KEY=…                              # brain thinking (Ollama if unset)
export VOICE_SSL_DIR=~/.local/state/scoria-voice/ssl   # browsers need https for the mic
.venv/bin/scoria-voice                                 # https://localhost:8998
```

Open `/console` to toggle the model on, edit the meta prompt, watch the
transcript and the brain's tool calls; open `/` for the stock PersonaPlex talk
UI (it connects to the same `/api/chat`).

| env | default | meaning |
|---|---|---|
| `BRAIN_PROVIDER` | `auto` | `auto` / `parasail` / `ollama`. Auto uses Parasail when a key is set |
| `PARASAIL_API_KEY` | unset | Cloud thinking. Same key as scoria-api chat |
| `PARASAIL_MODEL` | `parasail-glm-53-flash` | Parasail chat model for the brain |
| `BRAIN_MODEL` | best present of `gpt-oss:120b, qwen3.5:122b, gpt-oss:20b, qwen3.5:32b, qwen3.5:9b` | Ollama fallback |
| `WHISPER_MODEL` | `distil-large-v3` | faster-whisper model (CPU int8) |
| `VOICE_AUTOLOAD` | `0` | load weights at startup instead of on toggle |
| `VOICE_CPU_OFFLOAD` | `0` | PersonaPlex layer offload if VRAM is short |
| `STT_ENABLED` / `BRAIN_ENABLED` | `1` | kill switches |
| `VOICE_HOLD_MS` | `1200` | persona pauses this long (max) after a user utterance while the brain decides; `0` = never pause |
| `NO_CUDA_GRAPH` | unset | set to `1` to disable hip/CUDA graph capture (upstream switch) |

## Performance on this box (Strix Halo, Radeon 8060S, ROCm 7.2) — read this

Everything above works end to end on the AMD iGPU, but **not in real time**.
PersonaPlex needs one 80 ms step every 80 ms (12.5 Hz); measured per step
(`/tmp/voice_bench.py`-style, bf16, hip graphs on):

| part | ms / frame | why |
|---|---|---|
| main transformer (7.0 B params, 14 GB bf16) | ~117 | purely memory-bandwidth bound: torch reaches ~125 GB/s here, so 14 GB → 112 ms is the floor |
| depformer (1.36 B params, 8 sequential sub-steps × 6 layers) | ~53 | ~1200 tiny kernels; launch/latency bound, graphs barely help |
| mimi encode+decode (×2) + sampling + glue | ~12–20 | fine |
| **total** | **~182** | **≈ 0.45× real time** (priming the system prompt takes ~23 s) |

What would close the gap: weight-only quantisation with fused Triton GEMV
kernels (a hand-rolled int8 kernel already gets 1.7× on the big matrices; int4
would be ~4×) for the main transformer, plus `torch.compile` to shrink the
depformer's kernel count. Projected best case is ~80–110 ms/frame — borderline.
On any NVIDIA GPU with ≥ 24 GB (the model's intended target) it runs real time
out of the box, and this service is network-separable: point `OLLAMA_URL` and
`SCORIA_API_URL` at this machine and run `scoria-voice` where the GPU is.

## API

`GET /api/status` · `POST /api/engine {on}` · `GET|PUT /api/persona {base|refinements|voice|refine}` ·
`POST /api/say {text, interrupt}` · `POST /api/brief {text}` · `POST /api/mute {mute}` ·
`POST /api/ask {text}` (typed input, same path as speech) · `GET /api/events` (SSE) ·
`WS /api/chat?text_prompt=&voice_prompt=` (PersonaPlex protocol; `0x04` JSON carries transcripts and brain events).
