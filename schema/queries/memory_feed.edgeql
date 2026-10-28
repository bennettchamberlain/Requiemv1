# Memory feed for the caller. Policies decide visibility; the filter only pages.
# variables: $before (datetime, optional), $limit (int64)
select MemoryItem {
  id,
  kind,
  title,
  body,
  occurred_at,
  source,
  owner: { id, handle, display_name },
  place: { id, name, city },
}
filter (.occurred_at < <optional datetime>$before) ?? true
order by .occurred_at desc
limit <int64>$limit;
