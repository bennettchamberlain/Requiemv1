# Where the caller has been lately (Presence), newest day first.
# variables: $since (str, YYYY-MM-DD), $limit (int64)
select Presence {
  day,
  first_seen,
  last_seen,
  sample_count,
  place: { id, name, city, region, country, lat, lng },
}
filter .owner.id = global current_person_id
  and .day >= <cal::local_date><str>$since
order by .day desc then .last_seen desc
limit <int64>$limit;
