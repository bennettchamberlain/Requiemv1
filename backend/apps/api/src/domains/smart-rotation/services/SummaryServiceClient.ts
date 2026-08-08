import { Injectable } from '@nestjs/common';

import config from '@ci/configuration';

export type InsightsTriggerResult = {
  status: string;
  message?: string;
  reason?: string;
};

export type SummaryTriggerResult = {
  status: string;
  message?: string;
};

@Injectable()
export class SummaryServiceClient {
  private readonly baseUrl = config.services.parser.host.replace(/\/+$/, '');

  async generateInsights(
    userId: string,
    timezone = 'UTC',
    lookbackHours = 72,
    options: { trust_mode?: string; insight_volume_multiplier?: number } = {},
  ): Promise<InsightsTriggerResult> {
    const res = await fetch(`${this.baseUrl}/insights/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        timezone,
        lookback_hours: lookbackHours,
        trust_mode: options.trust_mode,
        insight_volume_multiplier: options.insight_volume_multiplier,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      throw new Error(`POST /insights/generate HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as InsightsTriggerResult;
  }

  async triggerSummary(
    userId: string,
    periodType: 'hourly' | 'dossier' = 'hourly',
    timezone = 'UTC',
  ): Promise<SummaryTriggerResult> {
    const res = await fetch(`${this.baseUrl}/summary/manual-trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, period_type: periodType, timezone }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');

      throw new Error(`POST /summary/manual-trigger HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    return (await res.json()) as SummaryTriggerResult;
  }
}
