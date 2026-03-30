# calibration.py

## Purpose
Runs post-training temperature scaling for the HMT model and writes the calibration artifacts used by inference and evaluation. The module also contains the shared batch-building helpers reused by adjacent model scripts.

## Components

### `calibrate`
- **Does**: Loads the checkpoint, searches for the best temperature, records ECE, and writes the calibrated checkpoint/report.
- **Interacts with**: `HMTModel` in `transformer.py`, `TokenStreamDataset` in `dataset.py`.

### `_find_temperature`, `_compute_nll`
- **Does**: Score candidate temperatures against the validation set.
- **Interacts with**: `_build_full_batch` in this file.

### `_measure_ece`, `_accumulate_ece_bins`, `_ece_from_bins`
- **Does**: Compute per-level calibration error from model outputs.
- **Interacts with**: `torch.nn.functional` softmax/log-softmax routines.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| `pipeline/inference_engine.py` | Calibrated checkpoint includes optional `temperature` | Changing checkpoint keys |
| `model/evaluator.py` | `_build_full_batch` shape and semantics remain stable | Changing tuple layout |

## Notes
- This hygiene pass removed an unused `torch.nn` import only; runtime behaviour is unchanged.
