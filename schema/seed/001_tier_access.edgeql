# Tier -> data classes unlocked by default. Edit as data, not as policy.
# Placeholder matrix; the tier list and these rows are expected to change.
# Run: `gel query -f seed/001_tier_access.edgeql` (policies off for this statement).

configure session set apply_access_policies := false;
for row in {
  ('household', 'presence'),
  ('household', 'memory'),
  ('household', 'encounter'),
  ('best_friend', 'presence'),
  ('best_friend', 'memory'),
  ('best_friend', 'encounter'),
  ('family', 'presence'),
  ('family', 'encounter'),
  ('close_friend', 'presence'),
  ('close_friend', 'encounter'),
  ('friend', 'presence'),
  ('friend', 'encounter'),
}
union (
  insert TierAccess {
    tier := <Tier>row.0,
    data_class := row.1,
  }
  unless conflict on ((.tier, .data_class))
);
