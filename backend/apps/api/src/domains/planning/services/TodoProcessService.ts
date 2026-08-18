import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm/services/OllamaService';
import { EventEntity } from '@ci/domains/memory';
import { PersonalizationService } from '@ci/domains/personalization';
import { SearchService } from '@ci/domains/search-next';

import { TaskService } from './TaskService';

const PROCESS_TIMEOUT_MS = 15_000;

const suggestionSchema = z.object({
  action: z.enum(['none', 'append', 'revise', 'reparent', 'complete']),
  confidence: z.number().optional(),
  notes: z.string().optional(),
  title: z.string().optional(),
  parentTitle: z.string().optional(),
  rationale: z.string().optional(),
});

async function searchBlock(
  searchService: SearchService,
  context: UserServiceContext,
  query: string,
  maxResults: number,
): Promise<string> {
  try {
    const results = await searchService.search(context, {
      query,
      mode: 'boosted',
      maxResults,
    });

    return (results ?? [])
      .map((hit) => {
        const parts = [hit.type, hit.id].filter(Boolean);

        return parts.join(':');
      })
      .join('\n');
  } catch {
    return '';
  }
}

/**
 * Reviews open tasks against recent memory and either applies high-confidence
 * mutations or queues a Plan-page confirmation (`task_mutate` / `task_complete`).
 */
@Injectable()
export class TodoProcessService {
  constructor(
    private readonly taskService: TaskService,
    private readonly searchService: SearchService,
    private readonly ollamaService: OllamaService,
    private readonly personalizationService: PersonalizationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TodoProcessService.name);
  }

  async runForUser(userId: string): Promise<{ applied: number; pending: number }> {
    const context = { userId } as UserServiceContext;
    const tallies = { applied: 0, pending: 0 };

    const tasks = await this.taskService.findAll(context, {
      status: ['open', 'in_progress'],
      limit: 40,
    });

    for (const task of tasks) {
      const block = await searchBlock(
        this.searchService,
        context,
        `${task.title} ${task.description ?? ''}`.trim(),
        8,
      );

      if (!block.trim()) {
        continue;
      }

      const suggestion = await this.suggest(context, task.title, block);

      if (!suggestion || suggestion.action === 'none') {
        continue;
      }

      const confidence = clampConfidence(suggestion.confidence);
      const kind = suggestion.action === 'complete' ? 'task_complete' : 'task_mutate';
      const decision = await this.personalizationService.decideAction(userId, { kind, confidence });

      if (decision === 'skip') {
        continue;
      }

      if (suggestion.action === 'complete') {
        if (decision === 'auto') {
          await this.taskService.complete(context, task.id);
          tallies.applied += 1;
        } else {
          await this.taskService.createPendingChange(context, {
            taskId: task.id,
            kind: 'complete',
            patch: {},
            rationale: suggestion.rationale ?? 'Looks like this may be done.',
            confidence,
          });
          tallies.pending += 1;
        }

        continue;
      }

      const patch: Record<string, unknown> = {};

      if (suggestion.action === 'append' && suggestion.notes?.trim()) {
        patch.appendNotes = suggestion.notes.trim();
      }

      if (suggestion.action === 'revise' && suggestion.title?.trim()) {
        patch.title = suggestion.title.trim();
      }

      if (suggestion.action === 'reparent' && suggestion.parentTitle?.trim()) {
        const parent = await this.taskService.findByTitleMatch(context, suggestion.parentTitle);

        if (parent && parent.id !== task.id) {
          patch.parentId = parent.id;
        }
      }

      if (Object.keys(patch).length === 0) {
        continue;
      }

      if (decision === 'auto') {
        if (typeof patch.appendNotes === 'string') {
          await this.taskService.appendNotes(context, task.id, patch.appendNotes);
        }

        const { appendNotes: _a, ...rest } = patch;

        if (Object.keys(rest).length > 0) {
          await this.taskService.update(context, task.id, rest);
        }

        tallies.applied += 1;
      } else {
        await this.taskService.createPendingChange(context, {
          taskId: task.id,
          kind: 'mutate',
          patch,
          rationale: suggestion.rationale ?? 'Suggested update from memory.',
          confidence,
        });
        tallies.pending += 1;
      }
    }

    this.logger.log('Todo process finished', { userId, ...tallies });

    return tallies;
  }

  private async suggest(
    context: UserServiceContext,
    title: string,
    memoryBlock: string,
  ): Promise<z.infer<typeof suggestionSchema> | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROCESS_TIMEOUT_MS);

    try {
      const prompt = [
        `Task: ${title}`,
        'Given the memory below, decide one action: none | append | revise | reparent | complete.',
        'Return JSON: {"action":"...","confidence":0-1,"notes":"...","title":"...","parentTitle":"...","rationale":"..."}',
        '',
        memoryBlock.slice(0, 4000),
      ].join('\n');

      const response = await this.ollamaService.chat(
        context as never,
        [{ role: 'user', content: prompt }],
        {
          model: PROMPT_MODEL,
          enableTools: false,
          format: 'json',
          signal: controller.signal,
        },
      );

      const parsed = suggestionSchema.safeParse(JSON.parse(response.message.content || '{}'));

      return parsed.success ? parsed.data : null;
    } catch (err) {
      this.logger.warn('Todo process LLM failed', {
        error: err instanceof Error ? err.message : String(err),
      });

      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * When planned blocks enter "the now", revise them from stream evidence
 * (cancel / rewrite) under `event_revise` trust gates.
 */
@Injectable()
export class EventNowService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    private readonly taskService: TaskService,
    private readonly searchService: SearchService,
    private readonly personalizationService: PersonalizationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(EventNowService.name);
  }

  async runForUser(userId: string): Promise<{ revised: number; pending: number }> {
    const context = { userId } as UserServiceContext;
    const tallies = { revised: 0, pending: 0 };
    const now = new Date();
    const windowStart = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(now.getTime() + 2 * 60 * 60 * 1000);

    const blocks = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.user_id = :userId', { userId })
      .andWhere('event.event_type = :type', { type: 'planned_block' })
      .andWhere('event.is_deleted = false')
      .andWhere('event.status IN (:...statuses)', { statuses: ['planned', 'tentative', 'confirmed'] })
      .andWhere('event.start_time BETWEEN :windowStart AND :windowEnd', { windowStart, windowEnd })
      .orderBy('event.start_time', 'ASC')
      .limit(20)
      .getMany();

    for (const block of blocks) {
      const title = (block.metadata?.title as string | undefined) ?? 'planned block';
      const recall = await searchBlock(
        this.searchService,
        context,
        `${title} what actually happened`,
        6,
      );

      if (!recall.trim()) {
        continue;
      }

      const lower = recall.toLowerCase();
      const cancelSignal =
        lower.includes('cancelled') ||
        lower.includes('canceled') ||
        lower.includes("didn't make") ||
        lower.includes('did not make') ||
        lower.includes('could not attend') ||
        lower.includes("couldn't attend");

      if (!cancelSignal) {
        continue;
      }

      const confidence = 0.8;
      const decision = await this.personalizationService.decideAction(userId, {
        kind: 'event_revise',
        confidence,
      });

      if (decision === 'auto') {
        block.status = 'cancelled';
        block.metadata = {
          ...block.metadata,
          revisedBy: 'planning.event_now',
          reviseRationale: 'Memory suggests the planned event did not occur as planned.',
        };
        await this.eventRepository.save(block);
        tallies.revised += 1;
      } else if (decision === 'review' && block.taskId) {
        await this.taskService.createPendingChange(context, {
          taskId: block.taskId,
          kind: 'event_revise',
          patch: { eventStatus: 'cancelled', eventId: block.id },
          rationale: 'Memory suggests this planned event may need to be cancelled or revised.',
          confidence,
        });
        tallies.pending += 1;
      }
    }

    this.logger.log('Event-now pass finished', { userId, ...tallies });

    return tallies;
  }
}

/**
 * After a scheduled block ends, look for completion evidence and auto-close
 * or ask on Plan (`task_complete`).
 */
@Injectable()
export class VerifyDoneService {
  constructor(
    @InjectRepository(EventEntity)
    private readonly eventRepository: Repository<EventEntity>,
    private readonly taskService: TaskService,
    private readonly searchService: SearchService,
    private readonly personalizationService: PersonalizationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(VerifyDoneService.name);
  }

  async runForUser(userId: string): Promise<{ completed: number; pending: number }> {
    const context = { userId } as UserServiceContext;
    const tallies = { completed: 0, pending: 0 };
    const now = new Date();
    const lookback = new Date(now.getTime() - 36 * 60 * 60 * 1000);

    const blocks = await this.eventRepository
      .createQueryBuilder('event')
      .where('event.user_id = :userId', { userId })
      .andWhere('event.task_id IS NOT NULL')
      .andWhere('event.is_deleted = false')
      .andWhere('event.status NOT IN (:...doneStatuses)', {
        doneStatuses: ['cancelled', 'completed', 'skipped', 'no_show'],
      })
      .andWhere('COALESCE(event.end_time, event.start_time) < :now', { now })
      .andWhere('COALESCE(event.end_time, event.start_time) > :lookback', { lookback })
      .orderBy('event.start_time', 'DESC')
      .limit(30)
      .getMany();

    for (const block of blocks) {
      if (!block.taskId) {
        continue;
      }

      const task = await this.taskService.findById(context, block.taskId);

      if (!task || task.status === 'done' || task.status === 'archived' || task.status === 'skipped') {
        continue;
      }

      const recall = await searchBlock(
        this.searchService,
        context,
        `did I finish or complete: ${task.title}`,
        6,
      );

      const lower = recall.toLowerCase();
      const doneSignal =
        lower.includes('finished') ||
        lower.includes('completed') ||
        lower.includes('done with') ||
        lower.includes('got it done') ||
        lower.includes('wrapped up');

      const confidence = doneSignal ? 0.85 : 0.55;
      const decision = await this.personalizationService.decideAction(userId, {
        kind: 'task_complete',
        confidence,
      });

      if (decision === 'auto' && doneSignal) {
        await this.taskService.complete(context, task.id);
        block.status = 'completed';
        await this.eventRepository.save(block);
        tallies.completed += 1;
      } else if (decision === 'review' || (decision === 'auto' && !doneSignal)) {
        await this.taskService.createPendingChange(context, {
          taskId: task.id,
          kind: 'complete',
          patch: { eventId: block.id },
          rationale: doneSignal
            ? 'Looks like this got done — confirm to mark complete?'
            : 'This scheduled item passed. Did it get done?',
          confidence,
        });
        tallies.pending += 1;
      }
    }

    this.logger.log('Verify-done pass finished', { userId, ...tallies });

    return tallies;
  }
}

function clampConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0.75;
  }

  return Math.min(1, Math.max(0, value));
}
