# Summary HTTP API

## Intent

`api.py` exposes health checks and explicit manual entry points over the same
functions used by scheduled work.

## Recovery trigger

`POST /summary/manual-trigger` accepts `period_type: hourly_backfill` in
addition to normal summary cadences. The request must carry explicit aligned
`start_time` and `end_time`; validation and the 24-hour safety bound are owned
by `functions.hourly_summary_backfill`.

This endpoint runs inline and is intended for a bounded operator recovery, not
as a replacement scheduler.
