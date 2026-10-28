# Keyword fallback when no embedding is available. Case-insensitive match
# on title or body; newest first.
# variables: $q (str), $limit (int64)
with
  pattern := '%' ++ str_replace(str_replace(<str>$q, '%', r'\%'), '_', r'\_') ++ '%'
select MemoryItem {
  id,
  kind,
  title,
  body,
  occurred_at,
  owner: { id, handle },
  place: { id, name, city, region, country, lat, lng },
  distance := <float64>0.5,
}
filter (.title ilike pattern) or (.body ilike pattern)
order by .occurred_at desc
limit <int64>$limit;
