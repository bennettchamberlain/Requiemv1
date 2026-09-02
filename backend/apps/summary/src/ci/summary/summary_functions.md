# Summary pure functions

## Intent

`summary_functions.py` transforms already-projected activity rows into bounded
model prompts and turns model output into summary, dossier, insight, and action
payloads.

## Hourly input contract

- Activity counts are derived from every list-valued source returned by the
  aggregator; adding a registered source requires no second hardcoded list.
- Metadata fields are ignored when counting.
- Prompt space is shared across non-empty sources so a busy early source cannot
  erase later sources.
- Each item is individually bounded, and the complete prompt has a hard
  character ceiling. Source projections place semantic fields first within
  that bound.

The module remains side-effect free except for explicitly injected model and
embedding calls, which keeps prompt construction independently testable.

Insight prompts include the semantic excerpt and named direction/participants
from each recent communication, rather than reducing the communication to its
subject line.
