"""TextPolicy pacing rules, with a fake SentencePiece tokenizer."""

from scoria_voice.hooked_lmgen import PAD, TextPolicy


class FakeTok:
    # id -> piece; ids >= 4 are pieces, "▁" marks a word start
    pieces = {4: "▁hello", 5: "▁wor", 6: "ld", 7: "▁there", 8: "▁x"}

    def encode(self, text):
        out = []
        for w in text.split():
            for i, p in self.pieces.items():
                if p == "▁" + w:
                    out.append(i)
                    break
            else:
                if w == "world":
                    out += [5, 6]
        return out

    def id_to_piece(self, i):
        return self.pieces[i]


def test_passthrough_when_nothing_queued():
    p = TextPolicy(tokenizer=FakeTok())
    assert p.choose(PAD) == PAD
    assert p.choose(7) == 7


def test_word_forced_only_when_model_speaks():
    p = TextPolicy(tokenizer=FakeTok(), patience_frames=100)
    assert p.say("hello") == 1
    assert p.choose(PAD) == PAD           # model silent -> wait
    assert p.choose(8) == 4               # model said a word -> ours instead
    assert p.pending == 0
    assert p.choose(8) == 8               # queue drained -> model free again


def test_continuation_pieces_forced_immediately():
    p = TextPolicy(tokenizer=FakeTok(), patience_frames=100)
    p.say("world")                        # [5, 6]
    assert p.choose(8) == 5
    assert p.choose(PAD) == 6             # continuation does not wait for a word


def test_patience_forces_after_silence():
    p = TextPolicy(tokenizer=FakeTok(), patience_frames=3)
    p.say("hello")
    assert [p.choose(PAD) for _ in range(3)] == [PAD, PAD, PAD]
    assert p.choose(PAD) == 4


def test_mute_turns_words_into_pad():
    p = TextPolicy(tokenizer=FakeTok())
    p.mute = True
    assert p.choose(8) == PAD
    assert p.choose(PAD) == PAD
    p.mute = False
    assert p.choose(8) == 8


def test_interrupt_replaces_queue():
    p = TextPolicy(tokenizer=FakeTok())
    p.say("hello there")
    p.say("x", interrupt=True)
    assert p.pending == 1
    assert p.choose(7) == 8
