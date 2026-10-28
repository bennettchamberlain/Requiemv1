"""LMGen with a text policy: let the brain choose words, keep the model's pacing.

PersonaPlex samples its text token *before* the depformer generates the audio
for that frame, and the whole stack already supports forcing text (that is
how the role prompt is fed). This subclass adds one decision point: after the
model samples a text token and before audio is generated, a `TextPolicy` may
replace it.

Policy rules:
* A word the brain wants said is only forced when the model itself sampled a
  word (not PAD/EPAD). The model keeps deciding *when* to speak; we decide
  *what*. Continuation pieces of a word already started are forced at once.
* If the model stays silent while text is queued for longer than `patience`
  frames, the word is forced anyway so a brain answer is never lost.
* `mute` turns any sampled word into PAD until released.

Token ids: 0 EPAD, 1 BOS, 2 EOS, 3 PAD; >= 4 are SentencePiece pieces.
"""

from __future__ import annotations

import collections
import threading
from dataclasses import dataclass, field

import torch
from moshi.models.lm import LMGen, sample_token

PAD = 3
EPAD = 0
SPECIAL_MAX = 3


@dataclass
class TextPolicy:
    tokenizer: object  # sentencepiece processor (id_to_piece)
    patience_frames: int = 30  # ~2.4 s at 12.5 Hz
    say_queue: collections.deque[int] = field(default_factory=collections.deque)
    mute: bool = False
    _silent_frames: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)
    frames_since_word: int = 0  # observed on the model's own stream, for "quiet" detection

    def say(self, text: str, *, interrupt: bool = False) -> int:
        """Queue text to be spoken. Returns number of tokens queued."""
        ids = self.tokenizer.encode(text.strip())
        with self._lock:
            if interrupt:
                self.say_queue.clear()
            self.say_queue.extend(ids)
            return len(ids)

    def clear(self) -> None:
        with self._lock:
            self.say_queue.clear()

    @property
    def pending(self) -> int:
        return len(self.say_queue)

    def _is_continuation(self, tok: int) -> bool:
        piece = self.tokenizer.id_to_piece(tok)
        return not piece.startswith("▁")

    def choose(self, sampled: int) -> int:
        """Return the token to commit for this frame given the model's sample."""
        with self._lock:
            model_spoke = sampled > SPECIAL_MAX
            self.frames_since_word = 0 if model_spoke else self.frames_since_word + 1
            if self.say_queue:
                nxt = self.say_queue[0]
                if model_spoke or self._is_continuation(nxt) or self._silent_frames >= self.patience_frames:
                    self.say_queue.popleft()
                    self._silent_frames = 0
                    return nxt
                self._silent_frames += 1
                return sampled if not model_spoke else PAD
            self._silent_frames = 0
            if self.mute and model_spoke:
                return PAD
            return sampled


class HookedLMGen(LMGen):
    """LMGen whose sampled text token passes through `policy.choose`."""

    policy: TextPolicy | None = None

    @torch.no_grad()
    def process_transformer_output(self, transformer_out, text_logits, provided_, target_, model_input_position, target_position):
        state = self._streaming_state
        lm_model = self.lm_model

        sampled_text_token = sample_token(
            text_logits.float(),
            self.use_sampling,
            self.temp_text,
            self.top_k_text,
        )
        sampled_text_token = sampled_text_token[:, 0, 0]  # [B]

        # --- the hook -------------------------------------------------------
        # Only when the text slot is not already forced (role prompt steps
        # force it), and only for batch size 1, which is all the server uses.
        if self.policy is not None and sampled_text_token.shape[0] == 1 and not bool(provided_[0, 0, 0]):
            chosen = self.policy.choose(int(sampled_text_token[0].item()))
            if chosen != int(sampled_text_token[0].item()):
                sampled_text_token = torch.full_like(sampled_text_token, chosen)
        # ---------------------------------------------------------------------

        next_text_token = torch.where(provided_[:, 0, 0], target_[:, 0, 0], sampled_text_token)

        if self.return_logits:
            sampled_audio_tokens, audio_logits = state.graphed_depth(
                next_text_token, transformer_out, target_[:, lm_model.audio_offset:, 0], provided_[:, lm_model.audio_offset:, 0])
        else:
            sampled_audio_tokens = state.graphed_depth(
                next_text_token, transformer_out, target_[:, lm_model.audio_offset:, 0], provided_[:, lm_model.audio_offset:, 0])

        state.provided[:, :, model_input_position] = False
        state.cache[:, 0, target_position] = torch.where(
            ~state.provided[:, 0, target_position],
            sampled_text_token,
            state.cache[:, 0, target_position],
        )
        state.cache[:, 1: lm_model.dep_q + 1, target_position] = torch.where(
            ~state.provided[:, 1: lm_model.dep_q + 1, target_position],
            sampled_audio_tokens,
            state.cache[:, 1: lm_model.dep_q + 1, target_position],
        )

        if state.offset <= self.max_delay:
            state.offset += 1
            return (None, None) if self.return_logits else None

        B = state.cache.shape[0]
        CT = state.cache.shape[2]
        gen_delays_cuda = self.delays_cuda[: lm_model.dep_q + 1]
        index = (((state.offset - self.max_delay + gen_delays_cuda) % CT).view(1, -1, 1).expand(B, -1, 1))
        out = state.cache.gather(dim=2, index=index)
        state.offset += 1
        if self.return_logits:
            return out, (text_logits.clone(), audio_logits.clone())
        return out

    # ---- mid-conversation system injection ---------------------------------

    @torch.no_grad()
    def inject_system_text(self, token_ids: list[int], trailing_silence_frames: int = 3) -> int:
        """Write a `<system>` block into the live stream.

        Same recipe as the role prompt: forced text over a silent Moshi frame
        and a sine user frame, then a short silence. Returns the number of
        model steps consumed; the caller must not send the (silent) audio of
        these steps to the client, or playback lags by that much.
        """
        n = 0
        for tok in token_ids:
            self.step(
                moshi_tokens=self._encode_zero_frame(),
                text_token=tok,
                input_tokens=self._encode_sine_frame(),
            )
            n += 1
        for _ in range(trailing_silence_frames):
            self.step(
                moshi_tokens=self._encode_zero_frame(),
                text_token=self.zero_text_code,
                input_tokens=self._encode_sine_frame(),
            )
            n += 1
        return n
