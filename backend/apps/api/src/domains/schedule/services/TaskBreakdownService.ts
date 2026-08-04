import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';

import { type RequestContext, type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm';

import type { CreateCandidateDto } from '../types';

import { CandidateService } from './CandidateService';

/** How far ahead a brain-dumped task claims it could happen. */
const DEFAULT_WINDOW_DAYS = 7;

/** Fallback when the model gives no duration. Same starting guess the adapters use. */
const DEFAULT_DURATION_MINUTES = 30;

/** Bound the model's output. A dump that yields 40 cards has not been broken down, it has been transcribed. */
const MAX_TASKS = 12;

/** Bound the input so one paste cannot blow the context window. */
const MAX_INPUT_CHARS = 4000;

/** Durations outside this are the model hallucinating, not estimating. */
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;

/**
 * L0 classes the model may assign. Same vocabulary HBPE uses, so a card dropped
 * on the grid is coloured by the schedule's own palette rather than landing as
 * "unsorted".
 */
const L0_CLASSES = [
  'WORK',
  'EXERCISE',
  'SOCIAL',
  'ERRAND',
  'LEISURE',
  'TRANSIT',
  'SLEEP',
  'UNKNOWN',
] as const;

const L0_SET = new Set<string>(L0_CLASSES);

const taskSchema = z.object({
  title: z.string().min(1),
  detail: z.string().optional(),
  duration_minutes: z.number().optional(),
  l0_class: z.string().optional(),
});

const responseSchema = z.object({
  tasks: z.array(taskSchema),
});

type ParsedTask = z.infer<typeof taskSchema>;

/**
 * The model splits, it does not invent.
 *
 * The failure mode worth designing against is helpfulness: asked to "break this
 * down", a model will happily add the steps it thinks you forgot. That turns the
 * user's own list into the model's list, and every invented card costs a dismiss.
 * Hence the repeated instruction to stay inside the text, and the low temperature.
 */
const PROMPT_HEADER = `You split a person's rough notes into discrete, schedulable tasks.

Rules:
- Split ONLY what is written. Never invent a task the notes do not mention, and never add preparation, follow-up, or "best practice" steps of your own.
- One task per distinct thing to do. If the notes name one thing, return one task.
- title: a short imperative phrase (max 60 chars). No trailing period.
- detail: the user's own wording for this task, lightly tidied. Omit if the title already says all of it.
- duration_minutes: your estimate, 5..480. Omit if you cannot tell.
- l0_class: one of WORK, EXERCISE, SOCIAL, ERRAND, LEISURE, TRANSIT, SLEEP, UNKNOWN. Use UNKNOWN when unsure.
- Preserve the order the notes give.

Respond with STRICT JSON only, no prose and no markdown fence:
{"tasks":[{"title":"...","detail":"...","duration_minutes":30,"l0_class":"WORK"}]}

Notes:
`;

/**
 * Turns a free-text brain dump into schedule candidates.
 *
 * The user types "need to book the dentist, prep Thursday's deck, and call Mum
 * back" and gets three draggable cards in Possibilities. Nothing is scheduled —
 * the cards land in exactly the same `ci.event_candidates` table the adapters
 * write to, so accept / decline / snooze, provenance, and the
 * do-not-resurrect rule all apply unchanged. Committing still means dragging a
 * card onto a day, as it does for every other suggestion.
 *
 * Deliberately NOT under the `adapter/` generator prefix: SuggestionSyncService
 * retires stale `adapter/` rows whose source action has been dismissed, and a
 * hand-written task has no upstream source to go stale. These rows are the
 * user's own words and are retired only by the user.
 */
@Injectable()
export class TaskBreakdownService {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly ollamaService: OllamaService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TaskBreakdownService.name);
  }

  /**
   * Break `text` into candidates and write them to the slate.
   *
   * @param at Instant the dump was written — anchors both the plausible window
   *   and the dedupe key. Injected rather than read from the clock so the same
   *   call is reproducible in a test.
   */
  async breakDown(
    context: UserServiceContext & RequestContext,
    text: string,
    at: Date = new Date(),
  ): Promise<Awaited<ReturnType<CandidateService['upsert']>>> {
    const trimmed = text.trim();

    if (trimmed.length === 0) {
      throw new BadRequestException('Nothing to break down');
    }

    if (trimmed.length > MAX_INPUT_CHARS) {
      throw new BadRequestException(`Keep it under ${MAX_INPUT_CHARS} characters`);
    }

    const tasks = await this.extract(context, trimmed);

    if (tasks.length === 0) {
      this.logger.warn('Task breakdown produced nothing usable', { chars: trimmed.length });

      return [];
    }

    const windowEnd = new Date(at.getTime() + DEFAULT_WINDOW_DAYS * 86_400_000);
    // One dump is one batch: the index alone would collide across dumps, and the
    // raw text alone would collide if the user submits the same list twice on
    // purpose. Together they make re-submitting the same dump idempotent within
    // a second and distinct across separate sittings.
    const batch = `${at.toISOString()}`;

    const proposals: CreateCandidateDto[] = tasks.map((task, index) => ({
      title: task.title,
      description: task.detail,
      // The because is the user's own note. Nothing on this list appears without
      // one, and for a hand-written task the honest answer is "you said so".
      rationale: task.detail ? `You wrote: ${task.detail}` : 'You wrote this down.',
      rationale_sources: [{ kind: 'answer', id: batch, note: 'typed on the schedule' }],
      window_start: at,
      window_end: windowEnd,
      time_flex: 'week',
      duration_minutes: task.duration_minutes ?? DEFAULT_DURATION_MINUTES,
      l0_class: task.l0_class,
      dedupe_key: `braindump:${batch}:${index}`,
      generator: 'braindump/llm',
      // Not a prediction — the user asked for these. High, but not 1.0: the
      // split itself is the model's guess even when the content is not.
      confidence: 0.9,
    }));

    const written = await this.candidateService.upsert(context, proposals);

    this.logger.log('Brain dump broken into candidates', {
      chars: trimmed.length,
      extracted: tasks.length,
      written: written.length,
    });

    return written;
  }

  /** Call the model and return the tasks that survive validation. */
  private async extract(context: RequestContext, text: string): Promise<ParsedTask[]> {
    const response = await this.ollamaService.chat(
      context,
      [{ role: 'user', content: PROMPT_HEADER + text }],
      // No tools: this is a pure text transform and a tool call here would only
      // be the model wandering off. `format: 'json'` is the only sampling
      // control OllamaService.chat forwards — temperature is not plumbed
      // through, so the prompt does the constraining instead.
      { model: PROMPT_MODEL, enableTools: false, format: 'json' },
    );

    return TaskBreakdownService.parseTasks(response.message.content);
  }

  /**
   * Parse the model's raw content into clean tasks.
   *
   * Tolerant of markdown fences and leading prose (same slice-to-outermost-braces
   * approach GraphEnrichmentService uses), and returns [] rather than throwing on
   * anything unparseable — a bad generation should surface as "nothing came back",
   * not as a 500.
   */
  static parseTasks(content: string): ParsedTask[] {
    let jsonStr = (content ?? '').replace(/```json\n?|\n?```/g, '').trim();

    const firstOpen = jsonStr.indexOf('{');
    const lastClose = jsonStr.lastIndexOf('}');

    if (firstOpen !== -1 && lastClose !== -1) {
      jsonStr = jsonStr.substring(firstOpen, lastClose + 1);
    }

    let parsed: z.infer<typeof responseSchema>;

    try {
      const result = responseSchema.safeParse(JSON.parse(jsonStr));

      if (!result.success) {
        return [];
      }

      parsed = result.data;
    } catch {
      return [];
    }

    const cleaned: ParsedTask[] = [];

    for (const task of parsed.tasks) {
      const title = task.title.trim().replace(/\.$/, '');

      if (title.length === 0) {
        continue;
      }

      const detail = task.detail?.trim();
      const l0 = task.l0_class?.trim().toUpperCase();
      const duration = task.duration_minutes;

      cleaned.push({
        title: title.slice(0, 60),
        // A detail that merely restates the title is noise on the card.
        ...(detail && detail.toLowerCase() !== title.toLowerCase() ? { detail } : {}),
        ...(typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration >= MIN_DURATION_MINUTES &&
        duration <= MAX_DURATION_MINUTES
          ? { duration_minutes: Math.round(duration) }
          : {}),
        // An out-of-vocabulary class is dropped rather than passed through: it
        // would colour the card as "unsorted" anyway, and this keeps whatever
        // the model invented out of ci.events.category on accept.
        ...(l0 && L0_SET.has(l0) && l0 !== 'UNKNOWN' ? { l0_class: l0 } : {}),
      });

      if (cleaned.length >= MAX_TASKS) {
        break;
      }
    }

    return cleaned;
  }
}
