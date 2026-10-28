# First person on a cluster. Superadmin; creates every later account.
# Handle/email are overridden by scoria-api at install time.
# Run once: `gel query -f seed/002_bootstrap_admin.edgeql` (policies off for this statement).

configure session set apply_access_policies := false;
insert Person {
  handle := 'admin',
  display_name := 'Scoria Admin',
  is_superadmin := true,
}
unless conflict on .handle;
