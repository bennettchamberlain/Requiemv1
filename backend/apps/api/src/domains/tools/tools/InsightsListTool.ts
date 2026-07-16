import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { toServiceContext } from '@ci/common/context';
import { LoggerService } from '@ci/common/logging';
import { ActionService } from '@ci/domains/intelligence';
import { SummaryService } from '@ci/domains/summaries';

import { BaseTool } from '../core/BaseTool';
import type { IntentDefinition, ToolExecutionContext } from '../core/types';

const DEFAULT_LIMIT = 20;

const InsightsListInputSchema = z.object({
  since: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'since must be an ISO-8601 date or datetime',
    })
    .optional(),
  limit: z.number().int().min(1).max(100).optional().default(DEFAULT_LIMIT),
});

export type InsightsListInput = z.infer<typeof InsightsListInputSchema>;

export type InsightItemKind = 'insight' | 'anomaly' | 'action';

export interface InsightListItem {
  /** Source record id: the summary id for insight/anomaly items, the action id for actions. */
  id: string;
  type: InsightItemKind;
  text: string;
  /** ISO-8601 timestamp the item refers to (summary period end / action creation), null if unknown. */
  occurredAt: string | null;
}

export interface InsightsListOutput {
  items: InsightListItem[];
}

/**
 * Curated intent over the derivation layer's outputs: recent summaries' key
 * insights and anomalies (SummaryService) plus active — non-dismissed —
 * suggested actions (ActionService), flattened into a single typed list.
 */
@Injectable()
export class InsightsListTool extends BaseTool<InsightsListInput, InsightsListOutput> {
  readonly schema: IntentDefinition = {
    name: 'insights.list',
    domain: 'insights',
    title: 'List insights',
    description:
      'List recent derived insights and anomalies from the summary engine plus active (non-dismissed) ' +
      'suggested actions, newest first. Each item carries the source record id, its kind ' +
      '(insight | anomaly | action), and the text.',
    privacy: { access: 'read', sensitivity: 'personal', destructive: false, external: false },
    phrases: [
      'What insights do you have for me',
      'Anything unusual lately',
      'What should I pay attention to',
      'Any suggested actions',
    ],
    parameters: {
      type: 'object',
      properties: {
        since: {
          type: 'string',
          format: 'date-time',
          description: 'Only include items from this ISO-8601 date/datetime onward.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: DEFAULT_LIMIT,
          description: 'Maximum number of items to return.',
        },
      },
    },
    examples: [
      {
        input: { since: '2026-07-08', limit: 10 },
        output: {
          items: [
            {
              id: '0198f1c2-…',
              type: 'anomaly',
              text: 'Unusually little movement recorded on Tuesday compared to a typical week.',
              occurredAt: '2026-07-14T23:59:59.000Z',
            },
            {
              id: '0198e0aa-…',
              type: 'action',
              text: 'Reply to the dentist about rescheduling the cleaning.',
              occurredAt: '2026-07-13T18:04:12.000Z',
            },
          ],
        },
        description: 'Insights, anomalies, and open actions from the past week.',
      },
    ],
  };

  constructor(
    private readonly summaryService: SummaryService,
    private readonly actionService: ActionService,
    protected readonly logger: LoggerService,
  ) {
    super();
    this.logger.setContext(InsightsListTool.name);
  }

  protected validateInput(input: unknown): InsightsListInput {
    return InsightsListInputSchema.parse(input ?? {});
  }

  protected async executeInternal(
    context: ToolExecutionContext,
    input: InsightsListInput,
  ): Promise<InsightsListOutput> {
    const serviceContext = toServiceContext(context);
    const since = input.since ? new Date(input.since) : null;

    const [summaries, actions] = await Promise.all([
      this.summaryService.findRecent(serviceContext, input.limit),
      this.actionService.findAll(serviceContext),
    ]);

    const items: InsightListItem[] = [];

    for (const summary of summaries) {
      const occurredAt = toIsoOrNull(summary.periodEnd);

      if (since && summary.periodEnd && new Date(summary.periodEnd) < since) {
        continue;
      }

      for (const text of summary.keyInsights) {
        pushItem(items, { id: summary.summaryId, type: 'insight', text, occurredAt });
      }

      for (const text of summary.anomalies) {
        pushItem(items, { id: summary.summaryId, type: 'anomaly', text, occurredAt });
      }
    }

    for (const action of actions) {
      if (action.dismissed) {
        continue;
      }

      if (since && action.createdAt && new Date(action.createdAt) < since) {
        continue;
      }

      const text = action.text ?? action.title ?? '';

      pushItem(items, { id: action.id, type: 'action', text, occurredAt: toIsoOrNull(action.createdAt) });
    }

    items.sort(byOccurredAtDesc);

    return { items: items.slice(0, input.limit) };
  }
}

function pushItem(items: InsightListItem[], item: InsightListItem): void {
  if (item.text.trim().length > 0) {
    items.push(item);
  }
}

function byOccurredAtDesc(a: InsightListItem, b: InsightListItem): number {
  // Nulls sort last; otherwise newest first, with a deterministic id tie-break.
  if (a.occurredAt === b.occurredAt) {
    return a.id.localeCompare(b.id);
  }

  if (a.occurredAt === null) {
    return 1;
  }

  if (b.occurredAt === null) {
    return -1;
  }

  return b.occurredAt.localeCompare(a.occurredAt);
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
