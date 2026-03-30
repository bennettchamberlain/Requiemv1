# vocab.py

## Purpose
Maps HBPE token identifiers to stable integer indices for model training and inference. It contains the fixed special-token layout and the database-backed L1 vocabulary loader.

## Components

### `Vocab`
- **Does**: Provides encode/decode helpers and stores the two-way token mapping.
- **Interacts with**: all model and inference modules.

### `build_l0_vocab`
- **Does**: Builds the static behavioural-class vocabulary.
- **Interacts with**: `L0_CLASSES` in `tokenizer/vocab_registry.py`.

### `build_l1_vocab`
- **Does**: Loads active L1 cluster IDs for a user from Postgres.
- **Interacts with**: `get_conn` in `database.py`.

## Contracts

| Dependent | Expects | Breaking changes |
|-----------|---------|------------------|
| Model code | Special-token indices stay fixed | Reordering special tokens |
| Inference code | Unknown tokens encode as `PAD_IDX` | Changing fallback semantics |

## Notes
- The code change here was limited to removing an unused `psycopg2.extras` import.
