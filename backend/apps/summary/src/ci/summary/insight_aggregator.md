# Insight aggregator

## Intent

`insight_aggregator.py` gathers grounded change context for proactive insight
generation: graph deltas, future events, recent communications, recent
non-insight summaries, relationships, and the user's dossier.

## Novelty contract

The sidecar owns the sole insight novelty decision. It compares each grounded
source with the timestamp of the last stored insight and treats these as new:

- graph deltas changed since that point;
- communications whose communication time is since that point;
- non-insight summaries stored since that point;
- events created or updated since that point.

Generated insights never enter the novelty input set and never feed HBPE. A
scheduler may dispatch redundantly; this gate makes redundant work cheap while
preserving retries after a failed generation.

Communication context projects compact semantic text plus sender/recipient
names. Subject-only context is insufficient for surfacing changes in a
conversation, while raw participant metadata and attachments are unnecessary.
