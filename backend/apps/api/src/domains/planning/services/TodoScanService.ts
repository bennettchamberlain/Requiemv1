import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm';
import { PersonalizationService } from '@ci/domains/personalization';
import { SearchService } from '@ci/domains/search-next';

import { TaskService } from './TaskService';

const MAX_SURFACED = 12;
const SCAN_TIMEOUT_MS = 20_000;
const MEMORY_LOOKBACK_QUERY =
  'tasks to-dos errands appointments commitments deadlines things I need to do or finish';

const itemSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
  confidence: z.number().optional(),
});

const responseSchema = z.object({
  items: z.array(z.unknown()),
});

const RESPONSE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['title'],
      },
    },
  },
  required: ['items'],
};

/**
 * Scans recent memory for possible to-dos, dedupes against open/done, and
 * either auto-adds or proposes based on the trust dial (`task_create`).
 *
 * Uses SearchService directly (not RecallService) so PlanningModule does not
 * import AgentModule → LLMModule → PlanningModule.
 */
@Injectable()
export class TodoScanService {
  constructor(
    private readonly taskService: TaskService,
    private readonly searchService: SearchService,
    private readonly ollamaService: OllamaService,
    private readonly personalizationService: PersonalizationService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(TodoScanService.name);
  }

  async runForUser(userId: string): Promise<{ created: number; proposed: number; appended: number }> {
    const context = { userId } as UserServiceContext;
    const tallies = { created: 0, proposed: 0, appended: 0 };

    const memoryBlock = await this.memoryBlock(context);

    if (!memoryBlock.trim()) {
      this.logger.debug('Todo scan found no memory hits', { userId });

      return tallies;
    }

    const surfaced = await this.surfaceItems(context, memoryBlock);

    for (const item of surfaced.slice(0, MAX_SURFACED)) {
      const title = item.title.trim();

      if (!title) {
        continue;
      }

      const confidence = clampConfidence(item.confidence);
      const sourceRef = TaskService.memoryScanSourceRef(title);
      const existing =
        (await this.taskService.findBySourceRef(context, 'memory_scan', sourceRef)) ??
        (await this.taskService.findByTitleMatch(context, title));

      if (existing) {
        if (item.detail?.trim()) {
          await this.taskService.appendNotes(context, existing.id, item.detail.trim());
          tallies.appended += 1;
        }

        continue;
      }

      const decision = await this.personalizationService.decideAction(userId, {
        kind: 'task_create',
        confidence,
      });

      if (decision === 'skip') {
        continue;
      }

      const status = decision === 'auto' ? 'open' : 'proposed';
      const created = await this.taskService.create(context, {
        title,
        description: item.detail?.trim() || null,
        status,
        sourceKind: 'memory_scan',
        sourceRef,
        metadata: { confidence, generator: 'planning.todo_scan' },
      });

      if (created) {
        if (status === 'proposed') {
          tallies.proposed += 1;
        } else {
          tallies.created += 1;
        }
      }
    }

    this.logger.log('Todo scan finished', { userId, ...tallies });

    return tallies;
  }

  private async memoryBlock(context: UserServiceContext): Promise<string> {
    try {
      const results = await this.searchService.search(context, {
        query: MEMORY_LOOKBACK_QUERY,
        mode: 'boosted',
        maxResults: 20,
      });

      return (results ?? [])
        .map((hit) => `${hit.type}:${hit.id}`)
        .join('\n');
    } catch (err) {
      this.logger.warn('Todo scan search failed', {
        error: err instanceof Error ? err.message : String(err),
      });

      return '';
    }
  }

  private async surfaceItems(
    context: UserServiceContext,
    memoryBlock: string,
  ): Promise<Array<{ title: string; detail?: string; confidence?: number }>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const prompt = [
        "You extract possible to-do items from a person's recent memory.",
        'Return only concrete actionable items the person still needs to do.',
        'Skip completed work, past events with no remaining action, and vague reflections.',
        'JSON: {"items":[{"title":"string","detail":"optional string","confidence":0.0-1.0}]}',
        '',
        'Memory:',
        memoryBlock.slice(0, 6000),
      ].join('\n');

      const response = await this.ollamaService.chat(
        context as never,
        [{ role: 'user', content: prompt }],
        {
          model: PROMPT_MODEL,
          enableTools: false,
          format: RESPONSE_JSON_SCHEMA,
          signal: controller.signal,
        },
      );

      const parsed = responseSchema.safeParse(JSON.parse(response.message.content || '{}'));

      if (!parsed.success) {
        return [];
      }

      const items: Array<{ title: string; detail?: string; confidence?: number }> = [];

      for (const unknownItem of parsed.data.items) {
        const item = itemSchema.safeParse(unknownItem);

        if (item.success && item.data.title.trim()) {
          items.push(item.data);
        }
      }

      return items;
    } catch (err) {
      this.logger.warn('Todo scan LLM failed; treating as empty', {
        error: err instanceof Error ? err.message : String(err),
      });

      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function clampConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0.75;
  }

  return Math.min(1, Math.max(0, value));
}
