# evaluator.py

## Purpose
Evaluates calibrated HMT checkpoints against held-out token streams and emits the report consumed during model validation. It focuses on L0 top-1 and L1 top-3 accuracy targets.

## Components

### `evaluate`
- **Does**: Runs leave-one-out masking over the test set and writes `eval_report.json`.
- **Interacts with**: `_load_calibrated` in this file and `_build_full_batch` in `calibration.py`.

### `_load_calibrated`
- **Does**: Loads either the calibrated checkpoint or the base checkpoint and reconstructs `HMTModel`.
- **Interacts with**: `HMTModel` in `transformer.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Validation scripts | `evaluate()` returns the report dict and writes the JSON file | Return shape or output path changes |
| `pipeline/inference_engine.py` | `_load_calibrated` returns `(model, temperature)` | Changing tuple order or type |

## Notes
- The only code change here was removing an unused `torch.nn.functional` import.
