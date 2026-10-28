# Days the caller and another person were in the same city.
# Reads Presence only; the other person's rows appear only if a tier
# default or grant lets this caller see class `presence`.
# variables: $other (uuid)
with
  me := (select Presence filter .owner.id = global current_person_id),
  them := (select Presence filter .owner.id = <uuid>$other),
  pairs := distinct (
    for m in me union (
      select (m.day, m.place.city)
      filter exists (
        select them filter .day = m.day and .place.city = m.place.city
      )
    )
  )
select (
  for p in pairs union (
    select { day := p.0, city := p.1 }
  )
)
order by .day;
