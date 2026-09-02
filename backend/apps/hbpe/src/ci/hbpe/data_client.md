# HBPE data client

## Intent

`data_client.py` is the read boundary between HBPE and application-owned data.
Summary reads only accept `ci.summaries.period_type = 'hourly'`; generated
insights and rollups are intentionally excluded from behavioral labels.

## Summary range contract

Historical recovery uses one direct SQL range query for unlabeled hourly
summaries rather than repeatedly downloading the entire GraphQL connection for
each day. The range is inclusive by calendar date and returns rows ordered by
`period_start`. Existing rows in `hbpe.summary_l1_label` are excluded in SQL.
