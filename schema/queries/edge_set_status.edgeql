# variables: $id (uuid), $status (str), $evidence (optional str)
select (
  update Edge
  filter .id = <uuid>$id
  set {
    status := <EdgeStatus><str>$status,
    evidence := (<optional str>$evidence) ?? .evidence,
    updated_at := datetime_of_statement(),
  }
) {
  id,
  kind,
  status,
  evidence,
  source: { id, name },
  target: { id, name },
};
