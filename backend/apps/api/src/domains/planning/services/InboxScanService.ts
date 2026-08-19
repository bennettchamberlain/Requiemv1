import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { z } from 'zod';

import { type UserServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { OllamaService, PROMPT_MODEL } from '@ci/domains/llm/services/OllamaService';
import { CommunicationEntity } from '@ci/domains/memory';
import { PersonalizationService } from '@ci/domains/personalization';

import { PlannedBlockService } from './PlannedBlockService';
import { TaskService } from './TaskService';

const MAX_MESSAGES = 30;
const MAX_SURFACED = 12;
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000;
const SCAN_TIMEOUT_MS = 20_000;
const INBOX_TYPES = ['email', 'sms', 'chat'];

const itemSchema = z.object({
  title: z.string(),
  detail: z.string().optional(),
  confidence: z.number().optional(),
  estimatedMinutes: z.number().optional(),
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
          estimatedMinutes: { type: 'number' },
        },
        required: ['title'],
      },
    },
  },
  required: ['items'],
};

/**
 * Triage recent inbound communications into tasks (CI-Planning `ingest_gmail`
 * / possibles, but writing `ci.tasks` directly). Email stays review-gated in
 * cautious/balanced; hands-off may auto-add and auto-place.
 */
@Injectable()
export class InboxScanService {
  constructor(
    @InjectRepository(CommunicationEntity)
    private readonly communicationRepository: Repository<CommunicationEntity>,
    private readonly taskService: TaskService,
    private readonly ollamaService: OllamaService,
    private readonly personalizationService: PersonalizationService,
    private readonly plannedBlockService: PlannedBlockService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(InboxScanService.name);
  }

  async runForUser(userId: string): Promise<{ created: number; proposed: number; placed: number }> {
    const context = { userId } as UserServiceContext;
    const tallies = { created: 0, proposed: 0, placed: 0 };
    const since = new Date(Date.now() - LOOKBACK_MS);

    const messages = await this.communicationRepository
      .createQueryBuilder('comm')
      .where('comm.user_id = :userId', { userId })
      .andWhere('comm.direction = :direction', { direction: 'inbound' })
      .andWhere('comm.communication_type IN (:...types)', { types: INBOX_TYPES })
      .andWhere('comm.time >= :since', { since })
      .andWhere('comm.is_archived = false')
      .orderBy('comm.time', 'DESC')
      .limit(MAX_MESSAGES)
      .getMany();

    if (messages.length === 0) {
      this.logger.debug('Inbox scan found no recent inbound messages', { userId });

      return tallies;
    }

    const block = messages
      .map((message) => formatMessage(message))
      .join('\n---\n')
      .slice(0, 8000);

    const surfaced = await this.surfaceItems(context, block);

    for (const item of surfaced.slice(0, MAX_SURFACED)) {
      const title = item.title.trim();

      if (!title) {
        continue;
      }

      const confidence = clampConfidence(item.confidence);
      const sourceRef = TaskService.memoryScanSourceRef(title, 'inbox');
      const existing =
        (await this.taskService.findBySourceRef(context, 'inbox', sourceRef)) ??
        (await this.taskService.findByTitleMatch(context, title));

      if (existing) {
        if (item.detail?.trim()) {
          await this.taskService.appendNotes(context, existing.id, item.detail.trim());
        }

        continue;
      }

      const decision = await this.personalizationService.decideAction(userId, {
        kind: 'task_create',
        confidence,
        hasUserInput: false,
      });

      if (decision === 'skip') {
        continue;
      }

      const status = decision === 'auto' ? 'open' : 'proposed';
      const created = await this.taskService.create(context, {
        title,
        description: item.detail?.trim() || null,
        status,
        estimatedMinutes:
          item.estimatedMinutes && item.estimatedMinutes > 0 ? Math.round(item.estimatedMinutes) : null,
        sourceKind: 'inbox',
        sourceRef,
        metadata: { confidence, generator: 'planning.inbox_scan' },
      });

      if (!created) {
        continue;
      }

      if (status === 'proposed') {
        tallies.proposed += 1;
        continue;
      }

      tallies.created += 1;
      const placed = await this.plannedBlockService.tryPlaceAfterOpen(context, created, confidence);

      if (placed.status === 'placed') {
        tallies.placed += 1;
      }
    }

    this.logger.log('Inbox scan finished', { userId, ...tallies });

    return tallies;
  }

  private async surfaceItems(
    context: UserServiceContext,
    inboxBlock: string,
  ): Promise<Array<z.infer<typeof itemSchema>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const prompt = [
        "You extract possible to-do items from a person's inbound inbox (email, SMS, chat).",
        'Return only concrete actionable items the person still needs to do.',
        'Skip newsletters, receipts with no action, FYI threads, and completed work.',
        'JSON: {"items":[{"title":"string","detail":"optional","confidence":0.0-1.0,"estimatedMinutes":number}]}',
        '',
        'Inbox:',
        inboxBlock,
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

      const items: Array<z.infer<typeof itemSchema>> = [];

      for (const unknownItem of parsed.data.items) {
        const item = itemSchema.safeParse(unknownItem);

        if (item.success && item.data.title.trim()) {
          items.push(item.data);
        }
      }

      return items;
    } catch (err) {
      this.logger.warn('Inbox scan LLM failed; treating as empty', {
        error: err instanceof Error ? err.message : String(err),
      });

      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

function formatMessage(message: CommunicationEntity): string {
  const subject = message.subject?.trim() || '(no subject)';
  const preview = (message.preview || message.summary || message.content || '').replace(/\s+/g, ' ').trim();

  return [
    `${message.communicationType} ${message.time.toISOString()}`,
    `Subject: ${subject}`,
    preview.slice(0, 500),
  ].join('\n');
}

function clampConfidence(value: number | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0.75;
  }

  return Math.min(1, Math.max(0, value));
}
