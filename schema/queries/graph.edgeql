# The caller's life graph: set objects plus the edges between them.
# Containment is `parent` / `parts`. Edges are the other relationships.
select assert_single((
  select Person {
    goals := (
      select .<owner[is Goal] {
        id,
        name,
        summary,
        status,
        why,
        target_on,
        parent: { id, name },
        parts: { id, name },
      }
      order by .name
      limit 40
    ),
    projects := (
      select .<owner[is Project] {
        id,
        name,
        summary,
        status,
        outcome,
        started_on,
        target_on,
        parent: { id, name },
        parts: { id, name },
      }
      order by .name
      limit 40
    ),
    habits := (
      select .<owner[is Habit] {
        id,
        name,
        summary,
        cue,
        routine,
        cadence,
        active,
        parent: { id, name },
        parts: { id, name },
      }
      order by .name
      limit 40
    ),
    entities := (
      select .<owner[is Entity] {
        id,
        name,
        summary,
        kind,
        parent: { id, name },
        parts: { id, name },
      }
      order by .name
      limit 40
    ),
    edges := (
      select .<owner[is Edge] {
        id,
        kind,
        status,
        evidence,
        source: { id, name },
        target: { id, name },
      }
      filter .status != EdgeStatus.rejected
      order by .created_at desc
      limit 80
    ),
  }
  filter .id = global current_person_id
));
