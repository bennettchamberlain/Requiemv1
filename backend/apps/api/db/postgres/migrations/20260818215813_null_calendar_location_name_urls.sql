-- migrate:up
-- A meeting-join link is not a place name.
--
-- ci-import-tools' calendar parser (.ics VLOCATION / Google & Outlook Calendar
-- API `location`) copied whatever the source calendar put in its location
-- field straight into ci.events.location_name — including, when the organizer
-- pasted a meeting link there instead of an address, a Zoom/Teams/Discord/
-- Calendly/Luma/etc. URL, or an AltspaceVR `altspace://` event URI. That is
-- the same defect CLASS as ffe607646 ("a coordinate pair is not a place
-- name"), fixed forward for future imports by isUriLocation (see
-- backend/apps/api/src/domains/geocode/util/virtualLocations.ts) gating
-- toEventInput / GoogleCalendarTransformService / OutlookCalendarTransformService
-- — this migration recovers the rows that already landed before that fix.
--
-- Verified against a real appliance database before writing this migration:
-- 78 rows match "the value, trimmed, IS NOTHING BUT a URI" (RFC 3986
-- `scheme "://" ...`, no other content) — all `source_system = 'calendar'`,
-- `source_type = 'ci-import-tools'`. A 79th row that superficially looked like
-- a candidate (`location_name` STARTS WITH a URL) is deliberately EXCLUDED:
-- "https://mongodb.zoom.us/j/636407622, NYC-38-3802 (4) [Zoom room]" pairs the
-- Zoom link with a real room designation, so nulling it would destroy a
-- genuine physical location alongside the link — exactly the "never touch a
-- real place name" case the narrow, whole-string predicate below (mirroring
-- isUriLocation, not the broader isVirtualLocation denylist) exists to avoid.
--
-- Idempotent: only touches rows that still match today; already-fixed or
-- since-corrected rows are untouched on a re-run.
UPDATE ci.events
   SET location_name = NULL
 WHERE location_name IS NOT NULL
   AND TRIM(location_name) ~* '^[a-z][a-z0-9+.-]*://\S+$';

-- migrate:down
-- No-op: the original values were never place names (see above) — restoring
-- a meeting-join URL into location_name would resurrect the bug, not undo the
-- migration. Nothing here distinguishes "nulled by this migration" from
-- "always NULL" to make a real reversal possible or meaningful.
