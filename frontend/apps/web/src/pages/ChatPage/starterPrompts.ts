/**
 * Starter asks offered by the empty Chat.
 *
 * These are not invented copy. Every line is a natural-language trigger phrase
 * declared by a shipped intent in the backend tool catalogue — the `phrases`
 * field on each tool schema in `backend/apps/api/src/domains/tools/tools/`,
 * collected by `IntentCatalogService.getManifest()` and published at
 * `GET /api/intents` (also the `intents://catalog` MCP resource). Quoting them
 * verbatim guarantees each starter lands on a capability Companion actually
 * has, and keeps one source of truth for "what can I ask this thing".
 *
 * Only slot-free phrases can be sent as-is; the templated ones ("Where is
 * $place", "Find $name") are deliberately excluded because a tap has nothing to
 * fill the slot with. The list is kept short — roughly one per domain — so it
 * stays scannable on a phone.
 *
 * Reading them from `/api/intents` at runtime was considered and rejected: the
 * endpoint is scope-guarded and the empty state must render instantly and
 * offline, so a network round trip would gate the first thing a user sees.
 */
export const STARTER_PROMPTS: readonly string[] = [
  'What is on Brief', // brief.list
  'Any suggested actions', // suggestions.list
  'What does tomorrow look like for me', // forecast.read
  'How accurate are my predictions', // forecast.calibration
  'Anything unusual lately', // anomalies.recent
  'What is associated with my mood', // insights.explain
  'Where do I usually go next', // places.next
  'Who is my family', // knowledge family/relationships
  'What are my preferences', // preferences.get
  'What can you import', // import.list_sources
];

/**
 * The starters above that a chat with no tools cannot be trusted to answer.
 *
 * Five of them are the trigger phrase of an intent whose data is NOT in what a turn is handed up
 * front (accuracy, anomalies, mood, next place, imports). The sixth, "What is on Brief", is: the
 * Brief snapshot rides on every turn. But a 1B model with no tools still invents Brief items now
 * and then (measured on gemma3:1b, the default tool-less model: one reply in four with the old
 * prompt, one in twenty after it was rebalanced, e.g. "send it to Trudy" when no such person is in
 * the data). A starter is the one question the app itself put in the person's mouth, and an
 * invented action in their Brief is worse than a starter that is not there.
 *
 * The other four (suggested actions, tomorrow, family, preferences) are covered by the Plan /
 * Forecast / Brief snapshots and the user context every turn carries, so they still work with
 * tools off.
 *
 * With tools off the empty Chat offers only those: a model that cannot call `places.next` answers
 * "Where do I usually go next" with a made-up place, a literal `tool_code` block, or the bare word
 * "Brief.list" (all seen on an iOS QA run).
 */
export const TOOL_STARTER_PROMPTS: ReadonlySet<string> = new Set([
  'What is on Brief', // brief.list: answerable from the snapshot, but still invented on a 1B model
  'How accurate are my predictions', // forecast.calibration
  'Anything unusual lately', // anomalies.recent
  'What is associated with my mood', // insights.explain
  'Where do I usually go next', // places.next
  'What can you import', // import.list_sources
]);
