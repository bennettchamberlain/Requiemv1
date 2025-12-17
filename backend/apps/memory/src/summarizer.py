"""
LLM-based summarization - calls OpenAI-compatible API and generates embeddings.

Simplified: Just call LLM, parse JSON, or fail gracefully.
"""
import json
import re
import structlog
from typing import Dict, List, Any, Optional
from datetime import datetime
from openai import OpenAI

from .config import settings

logger = structlog.get_logger()


class Summarizer:
    """Generates summaries using local LLM."""

    def __init__(self):
        self.client = OpenAI(base_url=settings.llm_api_base, api_key=settings.llm_api_key)
        logger.info("llm_client_initialized", model=settings.llm_model)

    def generate_hourly_summary(self, aggregated_data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate hourly summary from aggregated data."""
        activity_counts = self._count_activities(aggregated_data)

        if activity_counts.get("total", 0) == 0:
            return {
                "summary_text": "No activity recorded during this window.",
                "summary_type": "hourly",
                "key_insights": [],
                "embedding": self.generate_embedding("No activity"),
                "activity_counts": activity_counts,
                "tokens_used": 0,
            }

        # Build prompt
        prompt = self._build_data_prompt(aggregated_data, activity_counts)

        # Call LLM
        try:
            response = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": "You are an AI that creates concise hourly summaries. "
                        "Return valid JSON with: {summary_text, key_insights: [], notable_events: []}",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
            )

            raw = response.choices[0].message.content
            parsed = self._parse_json(raw) or {"summary_text": raw}

            summary_text = parsed.get("summary_text", raw)
            embedding = self.generate_embedding(summary_text)

            return {
                "summary_text": summary_text,
                "summary_type": "hourly",
                "key_insights": parsed.get("key_insights", parsed.get("insights", [])),
                "events": parsed.get("notable_events", parsed.get("events", [])),
                "anomalies": parsed.get("anomalies", []),
                "embedding": embedding,
                "activity_counts": activity_counts,
                "tokens_used": response.usage.total_tokens if response.usage else 0,
            }

        except Exception as exc:
            logger.error("hourly_summary_failed", error=str(exc))
            raise

    def generate_daily_summary(self, hourly_summaries: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate daily summary from hourly summaries."""
        return self._generate_rollup("daily", hourly_summaries)

    def generate_period_rollup(
        self,
        period_type: str,
        child_summaries: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Generate rollup summary (weekly/monthly/etc) from child summaries."""
        return self._generate_rollup(period_type, child_summaries)

    def generate_user_dossier(
        self,
        user_id: str,
        lookback_start: datetime,
        lookback_end: datetime,
        timezone: str,
        daily_summaries: List[Dict[str, Any]],
        hourly_summaries: List[Dict[str, Any]],
        max_chars: int,
        previous_dossier: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Generate user dossier from recent summaries."""
        if not daily_summaries and not hourly_summaries:
            return None

        prompt = self._build_dossier_prompt(
            daily_summaries, hourly_summaries, previous_dossier
        )

        try:
            response = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Create a user dossier with: {summary, tone, personalityTraits: [], interactionGuidelines: [], preferences: [], challenges: [], interests: []}",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=1200,
            )

            raw = response.choices[0].message.content
            parsed = self._parse_json(raw)

            if not parsed:
                # Fallback
                summary_text = " ".join(
                    [s.get("summary_text", "") for s in daily_summaries[-3:]]
                )
                parsed = {"summary": summary_text or "Limited data available."}

            # Normalize
            parsed.setdefault("summary", "No significant activity.")
            parsed.setdefault("tone", None)
            parsed.setdefault("personalityTraits", None)
            parsed.setdefault("interactionGuidelines", None)
            parsed.setdefault("preferences", None)
            parsed.setdefault("challenges", None)
            parsed.setdefault("interests", None)
            parsed.setdefault("lastUpdatedAt", datetime.utcnow().isoformat())
            parsed.setdefault("version", 1)
            parsed.setdefault(
                "sourceWindow",
                {
                    "start": lookback_start.isoformat(),
                    "end": lookback_end.isoformat(),
                    "timezone": timezone,
                },
            )

            # Truncate if needed
            if len(parsed["summary"]) > max_chars:
                parsed["summary"] = parsed["summary"][: max_chars - 3] + "..."

            return parsed

        except Exception as exc:
            logger.error("dossier_generation_failed", error=str(exc))
            return None

    def generate_history_summary(
        self,
        level: str,
        start_time: datetime,
        end_time: datetime,
        stats: Dict[str, Any],
        sample_entries: List[Dict[str, Any]],
    ) -> str:
        """Generate browser history summary."""
        prompt = f"""
Browser activity: {start_time} to {end_time}
Total entries: {stats['total_entries']}
Unique domains: {stats['unique_domains']}
Top domains: {stats.get('top_domains', 'n/a')}

Sample activity:
{chr(10).join([f"- {e.get('title', e.get('url'))}" for e in sample_entries[:5]])}

What was the user likely doing? (2-3 sentences)
"""

        try:
            response = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": "Infer user intent from browser history. Be concise.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=settings.llm_temperature,
                max_tokens=400,
            )
            return response.choices[0].message.content.strip()
        except Exception as exc:
            logger.error("history_summary_failed", error=str(exc))
            return ""

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding for text."""
        try:
            response = self.client.embeddings.create(
                model=settings.embedding_model, input=text
            )
            return response.data[0].embedding
        except Exception as exc:
            logger.error("embedding_generation_failed", error=str(exc))
            return [0.0] * settings.embedding_dimensions

    # ========================================================================
    # Internal helpers
    # ========================================================================

    def _generate_rollup(self, period_type: str, child_summaries: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generic rollup for daily/weekly/monthly/etc."""
        # Combine child summaries
        combined_text = "\n\n".join(
            [f"Summary {i + 1}: {s.get('summary_text', '')}" for i, s in enumerate(child_summaries)]
        )

        try:
            response = self.client.chat.completions.create(
                model=settings.llm_model,
                messages=[
                    {
                        "role": "system",
                        "content": f"Synthesize these summaries into a {period_type} overview. Focus on themes, patterns, and insights.",
                    },
                    {"role": "user", "content": combined_text},
                ],
                temperature=settings.llm_temperature,
                max_tokens=settings.llm_max_tokens,
            )

            summary_text = response.choices[0].message.content
            embedding = self.generate_embedding(summary_text)

            # Aggregate counts
            total_counts = {}
            for summary in child_summaries:
                counts = summary.get("activity_counts", {})
                for key, value in counts.items():
                    total_counts[key] = total_counts.get(key, 0) + value

            return {
                "summary_text": summary_text,
                "summary_type": period_type,
                "embedding": embedding,
                "activity_counts": total_counts,
                "num_child_summaries": len(child_summaries),
                "tokens_used": response.usage.total_tokens if response.usage else 0,
            }

        except Exception as exc:
            logger.error("rollup_summary_failed", period=period_type, error=str(exc))
            raise

    def _build_data_prompt(self, data: Dict[str, Any], counts: Dict[str, int]) -> str:
        """Build prompt from aggregated data."""
        parts = [
            f"Time: {data['start_time']} to {data['end_time']}",
            f"User: {data['user_id']}",
            "",
            "Activity counts:",
        ]

        for key, count in counts.items():
            if key != "total" and count > 0:
                parts.append(f"- {key}: {count}")

        parts.append("")

        # Add sample data from each category
        for category in ["measurements", "events", "communications", "activities", "messages", "files", "browser_activity"]:
            items = data.get(category, [])
            if items:
                parts.append(f"{category.upper()}:")
                for item in items[:5]:  # Top 5
                    parts.append(f"- {self._format_item(item)}")
                parts.append("")

        parts.append("Provide a concise 2-3 sentence summary of the hour.")
        return "\n".join(parts)

    def _build_dossier_prompt(
        self,
        daily_summaries: List[Dict[str, Any]],
        hourly_summaries: List[Dict[str, Any]],
        previous_dossier: Optional[Dict[str, Any]],
    ) -> str:
        """Build dossier prompt."""
        parts = ["Recent daily summaries:"]

        for summary in daily_summaries[-7:]:  # Last 7 days
            text = summary.get("summary_text", "")
            if text:
                parts.append(f"- {text[:200]}")

        if previous_dossier:
            parts.append("\nPrevious dossier (use as baseline):")
            parts.append(f"Summary: {previous_dossier.get('summary', '')[:300]}")

        parts.append("\nCreate an updated user dossier with personality, preferences, challenges, interests.")
        return "\n".join(parts)

    def _format_item(self, item: Dict[str, Any]) -> str:
        """Format a data item for prompt."""
        if "title" in item:
            return item["title"]
        if "activity_name" in item:
            return item["activity_name"]
        if "subject" in item:
            return item.get("subject", "")[:50]
        if "filename" in item:
            return item["filename"]
        if "url" in item:
            return item.get("url", "")[:50]
        return str(item)[:50]

    def _count_activities(self, data: Dict[str, Any]) -> Dict[str, int]:
        """Count activities by category."""
        counts = {
            key: len(data.get(key, []))
            for key in [
                "measurements",
                "positions",
                "communications",
                "activities",
                "events",
                "messages",
                "files",
                "api_logs",
                "browser_activity",
                "screen_captures",
            ]
        }
        counts["total"] = sum(counts.values())
        return counts

    def _parse_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Try to parse JSON from LLM response."""
        if not text:
            return None

        # Remove markdown code fences
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.IGNORECASE)

        # Try direct parse
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        # Try extracting JSON blob
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                pass

        return None


# Global summarizer instance
summarizer = Summarizer()

__all__ = ["summarizer", "Summarizer"]
