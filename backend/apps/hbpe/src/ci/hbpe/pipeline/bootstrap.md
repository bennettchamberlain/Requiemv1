# HBPE bootstrap steps

## Intent

`bootstrap.py` owns cold-start serialization-window calculation, token-stream
publication, HMT training, calibration, and model export.

## Summary relationship

Summary labeling is orchestrated immediately before serialization. The label
step targets the same bounded date range returned by `serialize_window`, so
every expensive label can become an HBPE token and the cold start does not
waste work outside the 90-day model corpus.
