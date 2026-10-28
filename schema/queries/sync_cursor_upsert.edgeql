# variables: $platform (str), $endpoint (str), $cursor (optional json),
#            $last_error (optional str)
select (
  insert SyncCursor {
    owner := assert_exists(global current_person),
    platform := <str>$platform,
    endpoint := <str>$endpoint,
    cursor := <optional json>$cursor,
    last_synced_at := datetime_of_statement(),
    last_error := <optional str>$last_error,
  }
  unless conflict on ((.owner, .platform, .endpoint))
  else (
    update SyncCursor set {
      cursor := <optional json>$cursor ?? .cursor,
      last_synced_at := datetime_of_statement(),
      last_error := <optional str>$last_error,
      updated_at := datetime_of_statement(),
    }
  )
) {
  id,
  platform,
  endpoint,
  cursor,
  last_synced_at,
  last_error,
};
