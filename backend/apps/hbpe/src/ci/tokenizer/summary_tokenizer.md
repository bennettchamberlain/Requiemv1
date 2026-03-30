# summary_tokenizer.py

## Purpose
Labels hourly summaries with L0/L1 classes and converts them into token-stream rows that can fill gaps left by event-derived coverage. It keeps summary-driven context available without rerunning Qwen on already-labeled summaries.

## Components

### `SummaryTokenizer.label_day`
- **Does**: Fetches unlabeled summaries, runs the two-stage Qwen classification flow, and persists labels.
- **Interacts with**: `get_unlabeled_summaries` in `data_client.py`, Qwen helpers in `qwen_labeler.py`.

### `SummaryTokenizer.get_tokens_for_day`
- **Does**: Returns serialized L0/L1 token rows for the labeled summaries on a date.
- **Interacts with**: `_build_summary_tokens` in this file.

### `_extract_summary_text`, `_store_summary_label`, `_build_summary_tokens`
- **Does**: Normalize summary content, persist labels, and expand hourly summaries into 30-minute token buckets.
- **Interacts with**: `get_conn` in `database.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `tokenizer/serializer.py` | Token rows match the serializer's expected shape | Changing record keys |
| Nightly pipeline | `label_day` returns the count of newly labeled summaries | Changing return semantics |

## Notes
- Labeling failures now log stack traces so bad summary payloads or Qwen/db errors can be diagnosed from production logs.
