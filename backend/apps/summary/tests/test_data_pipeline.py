"""Contracts for current-schema aggregation and bounded hourly prompts."""

from datetime import UTC, datetime
from uuid import UUID

import pytest

from ci.summary import data_aggregator, summary_functions
from ci.summary.summary_sources import SUMMARY_SOURCES

USER_ID = UUID("01a0124f-cbca-7609-938a-2d044dd8fbbc")
START = datetime(2026, 9, 2, 12, tzinfo=UTC)
END = datetime(2026, 9, 2, 13, tzinfo=UTC)


def test_registry_uses_current_grounded_sources_only():
    names = {source.name for source in SUMMARY_SOURCES}

    assert {
        "position",
        "communications",
        "events",
        "messages",
        "files",
        "content",
        "file_chunks",
        "notes",
        "tasks",
        "browser_activity",
        "objects",
        "object_observations",
        "receipts",
        "receipt_line_items",
        "answers",
        "tool_invocations",
    } == names
    assert names.isdisjoint(
        {
            "measurements",
            "activities",
            "api_logs",
            "screen_captures",
            "capture_events",
            "summaries",
            "insights",
            "activity_rollup",
            "agent_memories",
        }
    )


@pytest.mark.parametrize("source", SUMMARY_SOURCES, ids=lambda source: source.name)
def test_every_source_is_explicitly_scoped_and_bounded(source):
    normalized = " ".join(source.query.split()).lower()

    assert "from ci." in normalized
    assert ":user_id" in source.query
    assert ":start" in source.query
    assert ":end" in source.query
    assert ":limit" in source.query
    assert "select *" not in normalized


def test_semantic_text_precedes_bookkeeping_in_chat_and_communication_queries():
    queries = {source.name: source.query for source in SUMMARY_SOURCES}

    assert queries["messages"].index("LEFT(m.content") < queries["messages"].index(
        "m.thread_id"
    )
    assert queries["communications"].index("COALESCE") < queries[
        "communications"
    ].index("c.source_system")


def test_aggregator_queries_every_source_with_the_same_window(monkeypatch):
    calls: list[tuple[str, dict]] = []

    def execute(query: str, params: dict):
        calls.append((query, params))
        return [{"text": "material"}]

    monkeypatch.setattr(data_aggregator.db, "execute_query", execute)

    result = data_aggregator.DataAggregator().aggregate_hour(USER_ID, START, END)

    assert len(calls) == len(SUMMARY_SOURCES)
    assert {key for key, value in result.items() if isinstance(value, list)} == {
        source.name for source in SUMMARY_SOURCES
    }
    assert all(
        params
        == {
            "user_id": str(USER_ID),
            "start": START,
            "end": END,
            "limit": source.limit,
        }
        for (_, params), source in zip(calls, SUMMARY_SOURCES, strict=True)
    )


def test_aggregator_does_not_turn_a_schema_failure_into_an_empty_hour(monkeypatch):
    def fail(_query: str, _params: dict):
        raise RuntimeError("missing column")

    monkeypatch.setattr(data_aggregator.db, "execute_query", fail)

    with pytest.raises(RuntimeError, match="missing column"):
        data_aggregator.DataAggregator().aggregate_hour(USER_ID, START, END)


def test_activity_counts_follow_all_list_valued_sources():
    counts = summary_functions.count_activities(
        {
            "user_id": str(USER_ID),
            "start_time": START.isoformat(),
            "notes": [{"text": "one"}],
            "new_source": [{"text": "two"}, {"text": "three"}],
        }
    )

    assert counts == {"notes": 1, "new_source": 2, "total": 3}


def test_prompt_budget_preserves_semantic_material_from_late_sources(monkeypatch):
    monkeypatch.setattr(summary_functions, "MAX_HOURLY_PROMPT_CHARS", 500)
    data = {
        "messages": [{"text": "early semantic " + "a" * 500}],
        "tool_invocations": [{"intent": "late.semantic.intent", "detail": "b" * 500}],
    }
    counts = summary_functions.count_activities(data)

    prompt = summary_functions.build_data_prompt(data, counts)

    assert len(prompt) <= 500
    assert "early semantic" in prompt
    assert "Tool Invocations" in prompt
    assert "late.semantic.intent" in prompt
