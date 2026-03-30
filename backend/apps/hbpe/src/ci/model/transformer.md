# transformer.py

## Purpose
Defines the small transformer models used throughout HBPE: the L0 masked autoencoder and the full hierarchical HMT model. The file is intentionally compact because its role is the pure network definition, not training or evaluation.

## Components

### `L0MAEModel`
- **Does**: Encodes masked L0 token sequences and predicts vocabulary logits.
- **Interacts with**: `PAD_IDX` in `vocab.py`.

### `HMTModel`
- **Does**: Encodes interleaved L0/L1 sequences and emits per-level logits.
- **Interacts with**: training/calibration/evaluation modules across `model/`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Training/eval code | Constructor args are `(l0_vocab_size, l1_vocab_size)` | Signature or output tensor changes |
| Checkpoint loading | Parameter names remain stable | Renaming layers or embeddings |

## Notes
- This pass removed an unused `MASK_IDX` import; masking still happens in caller modules.
