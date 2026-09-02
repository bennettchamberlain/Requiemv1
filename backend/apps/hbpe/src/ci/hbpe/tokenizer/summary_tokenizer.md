# Summary tokenizer

## Intent

`summary_tokenizer.py` assigns grounded hourly summary text to HBPE L0/L1
labels and turns stored labels into lower-confidence bucket tokens. It never
reads insight, daily, weekly, or monthly summaries.

## Labeling contract

- `label_day` supports the ordinary single-day path.
- `label_range` supports bounded recovery with one database fetch.
- Both share exactly the same Qwen classification, quality checks, vocabulary
  updates, and idempotent label insert logic.
- One bad summary is logged and skipped without losing labels already stored.
