# Insight Engine Alpha — `spike/insight-engine-alpha`

> **Private & Confidential — Property of Lifescope Inc. Do not distribute.**
> Research spike consolidating the AI insight-engine workstream (CI-Engineering epic #49) into one runnable alpha. **Not for merge to main as-is** — pieces graduate via their own PRs (#1675, #1700, and follow-ups).

## What's in this branch

| Piece | Source | Status |
|---|---|---|
| HBPE live scoring loop — Brier/ECE/accuracy/drift from `hbpe.prediction_log` actuals → `hbpe.prediction_score` | PR #1675 (`backend/apps/hbpe/src/ci/pipeline/scoring.py`) | merged into spike, CI-green |
| Daily Feature Store — `ci_derived.daily_metrics` (10 metrics, coverage-aware) + compute-then-narrate descriptive question slice (20 questions) | PR #1700 (`backend/apps/api/src/domains/insights/`) | merged into spike, CI-green |
| Place clusters + next-place transition model (`ci_derived.place_clusters` / `place_transitions`) + metric forecasters (q10/50/90) | built on-spike (epic #58) | in progress |
| Calibration/forecast-history GraphQL egress + curated `predictions.*`/`insights.*` intents | built on-spike (epic #59) | in progress |
| `/predictions` dashboard — week heatmap, Next-Up differential, metric strips, calibration panel | built on-spike (epic #57) | in progress |

Design docs: `CI-Engineering/architecture/ai-roadmap.md`, `ai-strategy.md`, ADRs 0006–0008 + HBPE-0009 (CI-Engineering PR #56).

## Running the alpha

```bash
yarn install
docker compose up -d && yarn dev            # API + frontend
yarn workspace @ci/be-api migrate           # applies ci_derived.* migrations
# HBPE sidecar (scoring runs in the nightly pipeline; scoring.py self-bootstraps hbpe.prediction_score)
# Feature store demo over a real user/day:
yarn workspace @ci/be-api exec -- scripts/daily-insights-demo.ts <user_id> <YYYY-MM-DD>
```

Frontend: `/predictions` (gated on the `hbpe` feature flag, same as the ForecastStrip).

## What to explore with real data

1. **Does the forecast beat the naive baseline?** `hbpe.prediction_score` now measures it — watch Brier/ECE across a week of nightly runs.
2. **Do the daily metrics look true?** Run the demo script against known days; check the coverage fields catch thin days.
3. **Is next-place useful at 2 weeks of data?** hit-rate@3 from the transition model vs. "always predict home."
4. **Which dashboard panels earn attention?** The heatmap seam (actual|forecast) and the differential are the bets; calibration is the trust anchor.

## Known limitations (deliberate for the alpha)

- L1 scoring reads low pending the UUID↔display-name reconciliation (flagged in PR #1675).
- Narration uses the template Narrator; Ollama narrator is an interface stub.
- Metric forecasts are classical (EWMA/seasonal quantiles), not learned — by design at this data scale.
- Single-user assumptions throughout (matches HBPE).
