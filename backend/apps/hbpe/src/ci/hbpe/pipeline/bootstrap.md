# HBPE bootstrap steps

## Intent

`bootstrap.py` owns cold-start serialization-window calculation, token-stream
publication, HMT training, calibration, and model export.

## Summary relationship

Summary labeling is orchestrated immediately before serialization. The label
step targets the same bounded date range returned by `serialize_window`, so
every expensive label can become an HBPE token and the cold start does not
waste work outside the 90-day model corpus.

The bounds cover every dated source the serializer can publish: event
occurrence dates, hourly-summary periods, and completed tasks that already
have a behavioral class. This matters after an archive import: the newest
event may have occurred weeks ago while a summary of newly imported material
is created today. Event-only bounds would label and serialize through the old
event date and silently strand the new summary outside `hbpe.token_stream`.
