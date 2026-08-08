import json
import os

from ci.summary.llm_endpoint_env import apply_persisted_llm_endpoint


def test_apply_persisted_llm_endpoint_sets_env(tmp_path, monkeypatch):
    config_path = tmp_path / "llm-endpoint.json"
    config_path.write_text(
        json.dumps(
            {
                "backend": "openai_compatible",
                "port": 8000,
                "apiKey": "vllm-local",
                "hostGateway": "host.docker.internal",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.delenv("LLM_API_BASE", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.setenv("LLM_ENDPOINT_CONFIG_PATH", str(config_path))

    apply_persisted_llm_endpoint()

    assert os.environ["LLM_API_BASE"] == "http://host.docker.internal:8000/v1"
    assert os.environ["LLM_API_KEY"] == "vllm-local"


def test_apply_persisted_llm_endpoint_skips_when_env_set(tmp_path, monkeypatch):
    config_path = tmp_path / "llm-endpoint.json"
    config_path.write_text(
        json.dumps(
            {
                "backend": "openai_compatible",
                "port": 8000,
                "hostGateway": "host.docker.internal",
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("LLM_API_BASE", "http://example.com/v1")
    monkeypatch.setenv("LLM_ENDPOINT_CONFIG_PATH", str(config_path))

    apply_persisted_llm_endpoint()

    assert os.environ["LLM_API_BASE"] == "http://example.com/v1"
