# Recent memories plus the current life-graph snapshot for a weave pass.
# variables: $limit (int64)
select {
  memories := (
    select MemoryItem {
      id,
      kind,
      title,
      body,
      occurred_at,
      source,
      source_id,
      about: { id, name },
    }
    filter .owner = global current_person
    order by .occurred_at desc
    limit <int64>$limit
  ),
  things := (
    select Thing {
      id,
      name,
      summary,
      data_class,
      [is Entity].kind,
    }
    filter .owner = global current_person
    order by .name
    limit 80
  ),
  edges := (
    select Edge {
      id,
      kind,
      status,
      evidence,
      source: { id, name },
      target: { id, name },
    }
    filter .owner = global current_person
      and .status != EdgeStatus.rejected
    order by .created_at desc
    limit 80
  ),
};
