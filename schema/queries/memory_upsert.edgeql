# Idempotent ingest of one memory for the caller.
# variables: $kind, $title (optional), $body (optional), $occurred_at,
#            $source, $source_id
select (
  insert MemoryItem {
    owner := assert_exists(global current_person),
    kind := <str>$kind,
    title := <optional str>$title,
    body := <optional str>$body,
    occurred_at := <datetime>$occurred_at,
    source := <str>$source,
    source_id := <str>$source_id,
  }
  unless conflict on ((.owner, .source, .source_id))
  else (
    update MemoryItem set {
      kind := <str>$kind,
      title := <optional str>$title,
      body := <optional str>$body,
      occurred_at := <datetime>$occurred_at,
      updated_at := datetime_of_statement(),
    }
  )
) { id, created_at, updated_at };
