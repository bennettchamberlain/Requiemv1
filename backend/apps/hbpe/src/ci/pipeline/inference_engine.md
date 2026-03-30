# inference_engine.py

## Purpose
Implements HBPE's cached forecasting engine. It loads the best available model representation, memoizes per-day outputs, and aggregates them into horizon predictions without recomputing unaffected history.

## Components

### `_PyTorchSession`
- **Does**: Adapts the PyTorch fallback model to the same `run()` shape used by ONNX sessions.
- **Interacts with**: `HMTModel` loaded via `model/evaluator.py`.

### `InferenceEngine`
- **Does**: Loads vocab/model artifacts, fetches token streams, caches per-day outputs, and exposes prediction/invalidation methods.
- **Interacts with**: `settings` in `config.py`, `build_l0_vocab`/`build_l1_vocab` in `model/vocab.py`.

### `_load_session`, `_run_day`
- **Does**: Select the inference backend and normalize a day of tokens into model outputs.
- **Interacts with**: ONNX artifacts from `model/onnx_export.py` and calibrated checkpoints from `model/evaluator.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `pipeline/histogram_api.py` | `predict()` returns 48 forecast buckets in the existing schema | Output shape or keys |
| `api.py` / `ingester.py` | `invalidate()` and `invalidate_all()` remain available | Removing cache invalidation hooks |

## Notes
- This pass only removed dead imports and unused adapter state; session selection behaviour is unchanged.
