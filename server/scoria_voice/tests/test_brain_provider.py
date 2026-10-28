import os

from scoria_voice.config import Config


def test_parasail_is_the_default_brain_when_a_key_is_present(monkeypatch):
    monkeypatch.setenv("PARASAIL_API_KEY", "psk_test")
    monkeypatch.setenv("PARASAIL_MODEL", "parasail-glm-53-flash")
    monkeypatch.delenv("BRAIN_PROVIDER", raising=False)
    cfg = Config.from_env()
    assert cfg.parasail_api_key == "psk_test"
    assert cfg.parasail_model == "parasail-glm-53-flash"
    assert cfg.brain_provider == "auto"
    assert cfg.scoria_api_url == "http://127.0.0.1:8090"


def test_spoken_caps_at_two_sentences():
    from scoria_voice.brain import _spoken

    assert _spoken("One. Two. Three.") == "One. Two."
    assert "*" not in _spoken("**Hello** there.")
