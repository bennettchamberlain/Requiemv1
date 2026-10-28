import asyncio

import numpy as np

from scoria_voice.persona import Persona
from scoria_voice.stt import UtteranceSegmenter, VadParams, resample_linear


def test_persona_render_and_refine():
    p = Persona(base="Be brief.")
    p.refine("Call me Ben.")
    p.refine("Call me Ben.")  # dedup
    assert p.render() == "Be brief. Call me Ben."
    assert p.to_dict()["refinements"] == ["Call me Ben."]


def test_resample_length():
    x = np.zeros(24000, dtype=np.float32)
    assert len(resample_linear(x, 24000, 16000)) == 16000


class RecTranscriber:
    def __init__(self):
        self.calls = []

    def transcribe(self, pcm):
        self.calls.append(len(pcm))
        return "hi"


def test_segmenter_cuts_on_silence():
    async def run():
        got = []

        async def on_utt(text, s, e):
            got.append(text)

        t = RecTranscriber()
        seg = UtteranceSegmenter(t, 24000, on_utt, VadParams(end_ms=240, start_ms=160))
        frame = 1920
        rng = np.random.default_rng(0)
        for _ in range(5):                                  # noise floor
            seg.feed((rng.standard_normal(frame) * 0.001).astype(np.float32))
        for _ in range(10):                                 # speech ~0.8s
            seg.feed((rng.standard_normal(frame) * 0.2).astype(np.float32))
        assert seg.speaking
        for _ in range(4):                                  # silence -> cut
            seg.feed((rng.standard_normal(frame) * 0.001).astype(np.float32))
        assert not seg.speaking
        await asyncio.sleep(0.05)
        assert got == ["hi"]
        # Utterance = speech + pre-roll + trailing silence, resampled 24k -> 16k (x2/3).
        assert t.calls
        n16 = t.calls[0]
        assert n16 % 1280 == 0                              # whole 80 ms frames at 16k
        assert 10 * 1280 <= n16 <= 19 * 1280                # at least the speech, at most everything fed

    asyncio.run(run())
