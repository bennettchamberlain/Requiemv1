"""
Pure functions for summary generation.

These are stateless functions that can be called from Temporal activities.
All dependencies are passed as parameters.
"""
from typing import Dict, List, Any
import httpx
import json

from .config import settings
from .llm_config import LLMConfig


def count_activities(aggregated_data: Dict[str, Any]) -> Dict[str, int]:
    """
    Count activities in aggregated data.

    Pure function - no side effects, deterministic output.
    """
    counts = {
        "measurements": len(aggregated_data.get("measurements", [])),
        "position": len(aggregated_data.get("position", [])),
        "communications": len(aggregated_data.get("communications", [])),
        "activities": len(aggregated_data.get("activities", [])),
        "events": len(aggregated_data.get("events", [])),
        "messages": len(aggregated_data.get("messages", [])),
        "files": len(aggregated_data.get("files", [])),
        "browser_activity": len(aggregated_data.get("browser_activity", [])),
        "screen_captures": len(aggregated_data.get("screen_captures", [])),
    }
    counts["total"] = sum(v for k, v in counts.items() if k != "total")
    return counts


def build_data_prompt(aggregated_data: Dict[str, Any], activity_counts: Dict[str, int]) -> str:
    """
    Build prompt from aggregated data.

    Pure function - creates the LLM prompt from data.
    """
    parts = [f"Activity Summary ({activity_counts['total']} total items):"]

    for key, count in activity_counts.items():
        if key != "total" and count > 0:
            parts.append(f"\n{key.replace('_', ' ').title()}: {count} items")
            items = aggregated_data.get(key, [])
            if items:
                sample_size = min(10, len(items))
                parts.append(f"  Sample (first {sample_size}):")
                for item in items[:sample_size]:
                    item_str = json.dumps(item, default=str)
                    if len(item_str) > 200:
                        item_str = item_str[:200] + "..."
                    parts.append(f"    - {item_str}")

    return "\n".join(parts)


def generate_hourly_summary(
    llm_config: LLMConfig,
    aggregated_data: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Generate hourly summary from aggregated data.

    Pure function that uses LLM config to generate summary.
    """
    activity_counts = count_activities(aggregated_data)

    if activity_counts.get("total", 0) == 0:
        return {
            "summary_text": "No activity recorded during this window.",
            "summary_type": "hourly",
            "key_insights": [],
            "events": [],
            "anomalies": [],
            "embedding": generate_embedding(llm_config, "No activity"),
            "activity_counts": activity_counts,
            "tokens_used": 0,
        }

    # Build prompt
    prompt = build_data_prompt(aggregated_data, activity_counts)

    # Call LLM
    result = llm_config.agents['hourly'].run_sync(
        prompt,
        model_settings={
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
        },
    )

    response = result.output
    embedding = generate_embedding(llm_config, response.summary_text)

    # Convert to dict with structured data
    response_dict = response.model_dump(exclude_none=True)

    return {
        "summary_text": response.summary_text,
        "summary_type": "hourly",
        "key_insights": response.key_insights,
        "events": response.notable_events,
        "anomalies": response.anomalies,
        "structured_data": response_dict,
        "embedding": embedding,
        "activity_counts": activity_counts,
        "tokens_used": result.usage().total_tokens if result.usage() else 0,
    }


def generate_rollup_summary(
    llm_config: LLMConfig,
    period_type: str,
    child_summaries: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Generate rollup summary from child summaries.

    Pure function for daily/weekly/monthly/seasonal/yearly summaries.
    """
    # Get appropriate agent
    agent = llm_config.agents.get(period_type)
    if not agent:
        raise ValueError(f"No agent configured for period_type: {period_type}")

    # Build prompt from child summaries
    combined_text = "\n\n".join([
        f"Summary {i + 1}: {s.get('summary_text', '')}"
        for i, s in enumerate(child_summaries)
    ])

    prompt = f"Synthesize these summaries into a {period_type} overview:\n\n{combined_text}"

    # Call LLM
    result = agent.run_sync(
        prompt,
        model_settings={
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
        },
    )

    response = result.output
    embedding = generate_embedding(llm_config, response.summary_text)

    # Aggregate activity counts from children
    total_counts = {}
    for summary in child_summaries:
        counts = summary.get("activity_counts", {})
        for key, value in counts.items():
            total_counts[key] = total_counts.get(key, 0) + value

    # Convert response to dict
    response_dict = response.model_dump(exclude_none=True)

    return {
        "summary_text": response.summary_text,
        "summary_type": period_type,
        "structured_data": response_dict,
        "embedding": embedding,
        "activity_counts": total_counts,
        "num_child_summaries": len(child_summaries),
        "tokens_used": result.usage().total_tokens if result.usage() else 0,
    }


def generate_user_dossier(
    llm_config: LLMConfig,
    user_id: str,
    daily_summaries: List[Dict[str, Any]],
    hourly_summaries: List[Dict[str, Any]],
    previous_dossier: Dict[str, Any] = None,
) -> Dict[str, Any]:
    """
    Generate user dossier from summaries.

    Pure function that creates a personality/preference dossier.
    """
    # Build context from summaries
    daily_text = "\n\n".join([
        f"Day {i + 1}: {s.get('summary_text', '')}"
        for i, s in enumerate(daily_summaries)
    ])

    hourly_text = "\n\n".join([
        f"Hour {i + 1}: {s.get('summary_text', '')}"
        for i, s in enumerate(hourly_summaries)
    ])

    prompt_parts = [
        "Based on the following activity summaries, create a concise user dossier:",
        "\n## Recent Daily Summaries:",
        daily_text,
        "\n## Recent Hourly Summaries:",
        hourly_text,
    ]

    if previous_dossier:
        prompt_parts.insert(1, f"\n## Previous Dossier:\n{previous_dossier.get('summary', '')}")

    prompt = "\n".join(prompt_parts)

    # Call LLM
    result = llm_config.agents['dossier'].run_sync(
        prompt,
        model_settings={
            "temperature": settings.llm_temperature,
            "max_tokens": settings.llm_max_tokens,
        },
    )

    response = result.output

    # Build dossier payload
    from datetime import datetime
    return {
        "summary": response.summary,
        "tone": response.tone,
        "personalityTraits": response.personalityTraits,
        "interactionGuidelines": response.interactionGuidelines,
        "preferences": response.preferences,
        "challenges": response.challenges,
        "interests": response.interests,
        "lastUpdatedAt": datetime.utcnow().isoformat(),
        "version": 1,
    }


def generate_embedding(llm_config: LLMConfig, text: str) -> List[float]:
    """
    Generate embedding for text.

    Pure function that calls embedding endpoint.
    """
    if not text:
        return []

    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{settings.llm_api_base}/embeddings",
                json={
                    "model": settings.embedding_model,
                    "input": text[:8000],  # Limit input size
                },
                headers={"Authorization": f"Bearer {settings.llm_api_key}"}
            )
            response.raise_for_status()
            data = response.json()
            return data.get("data", [{}])[0].get("embedding", [])
    except Exception:
        # Return empty on error
        return []


__all__ = [
    "count_activities",
    "build_data_prompt",
    "generate_hourly_summary",
    "generate_rollup_summary",
    "generate_user_dossier",
    "generate_embedding",
]
