/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT EACH JOB ACTUALLY DOES.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The queue is named after its mechanism and the event after its trigger, so a
 * dashboard built from raw names tells an operator that `file.uploaded` is on
 * `image-description` — two facts that, together, still do not say what the
 * appliance is doing or whether it matters. Watching a live box, the entire
 * memory system reads as an undifferentiated wall of `file.uploaded`,
 * `preview.generated` and `smart.rotation.work`.
 *
 * This is the missing layer: for every event the codebase can emit, what it
 * does in plain language, which part of the system it belongs to, and whether a
 * human is waiting on it. The UI groups and filters by `category`, so "what is
 * happening in the memory system right now" becomes a question with an answer.
 *
 * Keeping it as data rather than scattering labels through the frontend means
 * the API can group by category in SQL, and an event that gains a listener
 * without gaining an entry here shows up as `unclassified` rather than silently
 * looking like everything else.
 */

/**
 * The part of the appliance a job belongs to.
 *
 * Deliberately coarse. These are the buckets an operator actually reasons in
 * when something is slow or stuck — not the module layout.
 */
export const JOB_CATEGORIES = {
  /** Making things findable: search index writes and embeddings. */
  search: 'search',
  /** Turning raw captures into memory: parsing, previews, dimensions, detection. */
  ingest: 'ingest',
  /** Adding meaning: descriptions, geocoding, location estimates, inference. */
  enrich: 'enrich',
  /** The life graph: people, places, visits, relationships. */
  graph: 'graph',
  /** The staged pipeline (index → enrich → embed) and its control plane. */
  pipeline: 'pipeline',
  /** Pulling data in from connected accounts. */
  import: 'import',
  /** Talking to a model: chat summaries, answer inference. */
  llm: 'llm',
  /** Feed, questions, dossier — what the companion shows the user. */
  personalization: 'personalization',
  /** Housekeeping: rotation, dead letters, telemetry, backfills. */
  maintenance: 'maintenance',
} as const;

export type JobCategory = (typeof JOB_CATEGORIES)[keyof typeof JOB_CATEGORIES];

export interface JobTypeDescriptor {
  /** Short human name for a table cell. */
  readonly label: string;
  readonly category: JobCategory;
  /** One sentence: what this job does, and why it exists. */
  readonly description: string;
  /**
   * True when a person is plausibly waiting on this right now — a chat turn, an
   * upload showing a spinner. Lets the UI separate "the box is busy" from "the
   * box is busy with something someone asked for".
   */
  readonly interactive?: boolean;
}

/**
 * Entity lifecycle events all mean the same thing to the search index, so they
 * are generated rather than written out 40 times.
 */
function searchIndexTypes(entity: string, label: string): Record<string, JobTypeDescriptor> {
  const verbs: Array<[string, string]> = [
    ['created', `Index a new ${label} for search`],
    ['updated', `Re-index an edited ${label}`],
    ['deleted', `Remove a deleted ${label} from the search index`],
  ];

  return Object.fromEntries(
    verbs.map(([verb, description]) => [
      `${entity}.${verb}`,
      {
        label: `${label} ${verb}`,
        category: JOB_CATEGORIES.search,
        description,
      } satisfies JobTypeDescriptor,
    ]),
  );
}

export const JOB_TYPES: Readonly<Record<string, JobTypeDescriptor>> = {
  // ── Search index ────────────────────────────────────────────────────────
  ...searchIndexTypes('note', 'note'),
  ...searchIndexTypes('event', 'calendar event'),
  ...searchIndexTypes('item', 'item'),
  ...searchIndexTypes('place', 'place'),
  ...searchIndexTypes('person', 'person'),
  ...searchIndexTypes('concept', 'concept'),
  ...searchIndexTypes('content', 'content record'),
  ...searchIndexTypes('answer', 'answer'),
  ...searchIndexTypes('thread', 'thread'),
  ...searchIndexTypes('message', 'message'),
  ...searchIndexTypes('communication', 'communication'),
  ...searchIndexTypes('browseractivity', 'browsing record'),
  'agent-memory.created': {
    label: 'Agent memory saved',
    category: JOB_CATEGORIES.search,
    description: 'Index something the agent chose to remember so it can be recalled later.',
  },
  'agent-memory.deleted': {
    label: 'Agent memory removed',
    category: JOB_CATEGORIES.search,
    description: 'Drop a forgotten agent memory from the search index.',
  },
  'search.embed.entity': {
    label: 'Embed for semantic search',
    category: JOB_CATEGORIES.search,
    description:
      'Compute the vector embedding that makes an entity findable by meaning rather than keyword. Runs on the local model, so a backlog here is usually the model being busy.',
  },

  // ── Ingest ──────────────────────────────────────────────────────────────
  'file.created': {
    label: 'File registered',
    category: JOB_CATEGORIES.ingest,
    description: 'A file record exists; index it so it is searchable by name and metadata.',
  },
  'file.uploaded': {
    label: 'File uploaded',
    category: JOB_CATEGORIES.ingest,
    description:
      'The fan-out point for everything a new file needs: preview generation, document parsing, inventory extraction and search indexing all hang off this one event. By far the highest-volume job on the appliance.',
  },
  'file.updated': {
    label: 'File changed',
    category: JOB_CATEGORIES.ingest,
    description: 'Re-index a file whose metadata changed.',
  },
  'file.deleted': {
    label: 'File removed',
    category: JOB_CATEGORIES.ingest,
    description: 'Drop a deleted file from the search index.',
  },
  'preview.generated': {
    label: 'Preview ready',
    category: JOB_CATEGORIES.ingest,
    description:
      'A thumbnail or preview finished rendering. Triggers image description, so a backlog here stalls every downstream vision job.',
  },
  'document.parsed': {
    label: 'Document parsed',
    category: JOB_CATEGORIES.ingest,
    description: 'Text was extracted from a document; index its chunks so the contents are searchable.',
  },
  'cv.detections.captured': {
    label: 'Objects detected',
    category: JOB_CATEGORIES.ingest,
    description: 'Store what the vision model found in a captured frame.',
  },
  'file.media-dimensions-backfill-request': {
    label: 'Backfill media dimensions',
    category: JOB_CATEGORIES.ingest,
    description: 'Fill in width and height for media that was imported without them.',
  },

  // ── Enrichment ──────────────────────────────────────────────────────────
  'event.geocode-batch-request': {
    label: 'Geocode locations',
    category: JOB_CATEGORIES.enrich,
    description:
      'Turn place names and coordinates into structured locations. Egresses to a metered provider, so this is rate-limited on purpose.',
  },
  'event.estimate-location-batch-request': {
    label: 'Estimate locations',
    category: JOB_CATEGORIES.enrich,
    description: 'Infer where something happened when it carries no explicit location.',
  },

  // ── Life graph ──────────────────────────────────────────────────────────
  'graph.person.created': {
    label: 'Person added to graph',
    category: JOB_CATEGORIES.graph,
    description: 'Record a newly recognised person as a node in the life graph.',
  },
  'graph.family.members.added': {
    label: 'Family linked',
    category: JOB_CATEGORIES.graph,
    description: 'Connect family relationships between people in the graph.',
  },
  'graph.preference.added': {
    label: 'Preference recorded',
    category: JOB_CATEGORIES.graph,
    description: 'Store something learned about what the user likes or avoids.',
  },
  'graph.preferences.added': {
    label: 'Preferences recorded',
    category: JOB_CATEGORIES.graph,
    description: 'Store a batch of learned preferences.',
  },
  'graph.location.created': {
    label: 'Location added to graph',
    category: JOB_CATEGORIES.graph,
    description: 'Record a place as a node in the life graph.',
  },
  'graph.visit.recorded': {
    label: 'Visit recorded',
    category: JOB_CATEGORIES.graph,
    description: 'Link a person or place to a point in time they were visited.',
  },
  'graph.connection.created': {
    label: 'Connection recorded',
    category: JOB_CATEGORIES.graph,
    description: 'Record a relationship between two people in the graph.',
  },
  'graph.node.upserted': {
    label: 'Graph node written',
    category: JOB_CATEGORIES.graph,
    description: 'Create or update a node in the life graph.',
  },
  'graph.node.updated': {
    label: 'Graph node updated',
    category: JOB_CATEGORIES.graph,
    description: 'Update an existing life-graph node.',
  },
  'graph.node.deleted': {
    label: 'Graph node deleted',
    category: JOB_CATEGORIES.graph,
    description: 'Remove a node from the life graph.',
  },
  'graph.relationship.upserted': {
    label: 'Graph edge written',
    category: JOB_CATEGORIES.graph,
    description: 'Create or update an edge between two life-graph nodes.',
  },
  'graph.relationship.deleted': {
    label: 'Graph edge deleted',
    category: JOB_CATEGORIES.graph,
    description: 'Remove an edge from the life graph.',
  },

  // ── Pipeline ────────────────────────────────────────────────────────────
  'pipeline.slice': {
    label: 'Pipeline slice',
    category: JOB_CATEGORIES.pipeline,
    description:
      'One batch of entities through one pipeline stage. The unit of work the staged pipeline actually schedules.',
  },
  'pipeline.sweep': {
    label: 'Pipeline sweep',
    category: JOB_CATEGORIES.pipeline,
    description: 'Look for entities whose stage version is behind and queue slices for them.',
  },
  'pipeline.dead_letter.reap': {
    label: 'Harvest dead letters',
    category: JOB_CATEGORIES.pipeline,
    description:
      'Copy exhausted-retry jobs out of the dead-letter queue into a durable table so the failure survives pg-boss retention.',
  },
  'content.created': {
    label: 'Content staged',
    category: JOB_CATEGORIES.pipeline,
    description: 'New raw content arrived and needs to enter the pipeline.',
  },
  'content.updated': {
    label: 'Content changed',
    category: JOB_CATEGORIES.pipeline,
    description: 'Re-index content whose body or metadata changed.',
  },
  'content.deleted': {
    label: 'Content removed',
    category: JOB_CATEGORIES.pipeline,
    description: 'Drop deleted content from the search index.',
  },

  // ── Import / ETL ────────────────────────────────────────────────────────
  'connectionSyncJob.execute': {
    label: 'Sync connected account',
    category: JOB_CATEGORIES.import,
    description:
      'Fetch a page of data from a connected provider (mail, calendar, photos). Rate-limited to one endpoint per connection at a time.',
  },
  'connectionSyncJob.transform': {
    label: 'Transform synced data',
    category: JOB_CATEGORIES.import,
    description: 'Map a provider payload into the appliance memory model.',
  },
  'import.stage': {
    label: 'Import stage',
    category: JOB_CATEGORIES.import,
    description: 'One stage of a bulk archive import. Long-running; runs in the worker process.',
  },

  // ── LLM ─────────────────────────────────────────────────────────────────
  'chat.summarization': {
    label: 'Summarize conversation',
    category: JOB_CATEGORIES.llm,
    description: 'Condense a chat thread so it fits future prompts.',
    interactive: true,
  },
  'infer.question.answer': {
    label: 'Infer an answer',
    category: JOB_CATEGORIES.llm,
    description:
      'Answer an open question about the user from what the appliance already knows, rather than asking them.',
  },
  'python.function.run': {
    label: 'Run analysis function',
    category: JOB_CATEGORIES.llm,
    description:
      'Hand work to the Python sidecar (summaries, behavioural pattern extraction). Completion is reported back by webhook, so these sit `active` while the sidecar works.',
  },

  // ── Personalization ─────────────────────────────────────────────────────
  'action.created': {
    label: 'Action suggested',
    category: JOB_CATEGORIES.personalization,
    description: 'A suggested action was generated; queue it for the feed.',
  },
  'summary.created': {
    label: 'Summary ready',
    category: JOB_CATEGORIES.personalization,
    description: 'A summary was generated; queue it for the feed.',
  },
  'context.prompt.persist': {
    label: 'Persist context prompt',
    category: JOB_CATEGORIES.personalization,
    description: 'Save the generated dossier the companion uses to sound like it knows the user.',
  },
  'question.created': {
    label: 'Question raised',
    category: JOB_CATEGORIES.personalization,
    description: 'A new question about the user was raised for the feed.',
  },

  // ── Maintenance ─────────────────────────────────────────────────────────
  'smart.rotation.work': {
    label: 'Scheduled upkeep',
    category: JOB_CATEGORIES.maintenance,
    description:
      'The rotating maintenance job. What it actually does depends on its work type — feed questions, dossier summaries, graph linking and so on.',
  },
  'tool.invoked': {
    label: 'Tool telemetry',
    category: JOB_CATEGORIES.maintenance,
    description: 'Record that an agent tool ran, for usage reporting.',
  },
} as const;

/** Human labels for the `smart.rotation.work` work types. */
export const SMART_ROTATION_WORK_LABELS: Readonly<Record<string, string>> = {
  question_feed: 'Refresh feed questions',
  answer_infer: 'Infer answers',
  schedule_sync: 'Sync schedule',
  insights: 'Generate insights',
  summaries: 'Summaries / dossier',
  graph_link: 'Link graph entities',
  graph_enrich: 'Enrich graph entities',
  context_prompt: 'Rebuild context prompt',
  hydrate_answers: 'Hydrate answers',
  hydrate_inventory: 'Hydrate inventory',
  promotion_review: 'Review entity promotions',
};

const UNCLASSIFIED: JobTypeDescriptor = {
  label: 'Unclassified job',
  category: JOB_CATEGORIES.maintenance,
  description:
    'No taxonomy entry for this event name. Either it is new, or it was renamed without updating domains/events/taxonomy.ts.',
};

/**
 * Describe a job from its event name and (for rotation work) its work type.
 *
 * Never throws and never returns undefined: an unknown event is a gap in this
 * file, not a reason for the dashboard to fail.
 */
export function describeJob(event: string | null, workType?: string | null): JobTypeDescriptor {
  if (!event) {
    return UNCLASSIFIED;
  }

  const base = JOB_TYPES[event];

  if (!base) {
    return UNCLASSIFIED;
  }

  // The rotation job is one event covering eleven unrelated activities; naming
  // the activity is the whole point of showing it.
  if (event === 'smart.rotation.work' && workType) {
    return {
      ...base,
      label: SMART_ROTATION_WORK_LABELS[workType] ?? workType,
      description: `${base.description} This run: ${SMART_ROTATION_WORK_LABELS[workType] ?? workType}.`,
    };
  }

  return base;
}

/** Every category, with the event names in it — used to drive the UI filter. */
export function jobCategoryIndex(): Record<JobCategory, string[]> {
  const index = Object.fromEntries(
    Object.values(JOB_CATEGORIES).map((category) => [category, [] as string[]]),
  ) as Record<JobCategory, string[]>;

  for (const [event, descriptor] of Object.entries(JOB_TYPES)) {
    index[descriptor.category].push(event);
  }

  return index;
}
