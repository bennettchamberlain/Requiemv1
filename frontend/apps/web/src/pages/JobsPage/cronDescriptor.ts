import { categoryLabel } from './jobCategories';
import type { JobTypesResponse } from './useJobTypes';

/**
 * What a recurring job actually is, derived from how it registered.
 *
 * Crons register as `ClassName.methodName`, which is precise but not a name a
 * person reads. The Jobs table gets its labels from the taxonomy, keyed by EVENT
 * name — but most crons don't emit an event of their own, so almost none of them
 * hit it. Falling back to the bare method name produced eight schedules all
 * called "Run", and lumping the lot under one category made the column useless.
 *
 * So: prefer the taxonomy when the cron's key IS a known event, otherwise derive
 * from the class. The class is the honest source — it says which subsystem
 * registered the job — and it's already right there in the key.
 */

/** Class-name prefix → category. First match wins, so order matters. */
const CLASS_CATEGORY: ReadonlyArray<readonly [RegExp, string]> = [
  [/^SmartRotation/, 'personalization'],
  [/^Pipeline/, 'pipeline'],
  [/^PythonFunction/, 'llm'],
  [/^AnswerInference/, 'llm'],
  [/Sync(Orchestrator|Cron)/, 'import'],
  [/^EntityPromotion/, 'graph'],
  [/^(DailyMetrics|ActivityRollup|JobMetrics)/, 'maintenance'],
  [/^(DeadLetterReaper|MemoryCompaction|FeedQueue|InitialActions|StagedUploadPurge)/, 'maintenance'],
  [/^Mcp/, 'maintenance'],
];

/**
 * Method names too generic to identify a job on their own — for these the class
 * carries the meaning, so the label is built from the class instead.
 */
const GENERIC_METHODS = new Set([
  'run',
  'tick',
  'execute',
  'handle',
  'process',
  'cron',
  'onschedule',
  'runonschedule',
  'tickonschedule',
  'reaponschedule',
  'sampleonschedule',
]);

export interface CronDescriptor {
  readonly label: string;
  readonly category: string;
  readonly categoryLabel: string;
}

export function describeCron(name: string, jobTypes: JobTypesResponse | null): CronDescriptor {
  // 1. The cron key IS a known event — use exactly what the Jobs table shows.
  const fromTaxonomy = jobTypes?.types?.[name];
  if (fromTaxonomy) {
    return {
      label: fromTaxonomy.label,
      category: fromTaxonomy.category,
      categoryLabel: categoryLabel(fromTaxonomy.category),
    };
  }

  const [cls, method] = splitKey(name);
  const category = CLASS_CATEGORY.find(([pattern]) => pattern.test(cls))?.[1] ?? 'maintenance';

  return { label: buildLabel(cls, method), category, categoryLabel: categoryLabel(category) };
}

function splitKey(name: string): [string, string] {
  const dot = name.lastIndexOf('.');

  return dot === -1 ? [name, ''] : [name.slice(0, dot), name.slice(dot + 1)];
}

/**
 * `SmartRotationInsightsCron.run` → "Smart rotation insights".
 * `FeedQueueCron.topUpFeedQueue`  → "Top up feed queue".
 *
 * The method wins when it says something; the class wins when the method is
 * generic. `Cron`/`Service`/`Listener` suffixes are dropped — every row would
 * otherwise end in the same noise word.
 */
function buildLabel(cls: string, method: string): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(cls)) {
    return cls; // an unnamed cron; nothing better to say
  }

  const useClass = !method || GENERIC_METHODS.has(method.toLowerCase());
  const source = useClass ? cls.replace(/(Cron|Service|Listener|Controller|Collector)s?$/, '') : method;

  return sentenceCase(source);
}

function sentenceCase(identifier: string): string {
  const words = identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
