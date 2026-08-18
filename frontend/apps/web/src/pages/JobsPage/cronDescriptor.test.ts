import { describe, expect, it } from 'vitest';

import { describeCron } from './cronDescriptor';
import type { JobTypesResponse } from './useJobTypes';

const TAXONOMY: JobTypesResponse = {
  categories: ['ingest'],
  types: {
    'file.uploaded': {
      label: 'File uploaded',
      category: 'ingest',
      description: '',
      interactive: false,
    },
  },
};

describe('describeCron', () => {
  it('prefers the taxonomy when the cron key is a known event', () => {
    const d = describeCron('file.uploaded', TAXONOMY);

    // Same words the Jobs table uses — one vocabulary across both cards.
    expect(d.label).toBe('File uploaded');
    expect(d.category).toBe('ingest');
  });

  it('uses the CLASS when the method name says nothing', () => {
    // Eight schedules registered as `PythonFunctionCrons.run` all rendered as
    // "Run", which is why the class has to win for generic method names.
    expect(describeCron('SmartRotationInsightsCron.run', null).label).toBe('Smart rotation insights');
    expect(describeCron('PipelineControlService.tickOnSchedule', null).label).toBe('Pipeline control');
    expect(describeCron('DeadLetterReaperListener.reapOnSchedule', null).label).toBe('Dead letter reaper');
  });

  it('uses the METHOD when it carries the meaning', () => {
    expect(describeCron('FeedQueueCron.topUpFeedQueue', null).label).toBe('Top up feed queue');
    expect(describeCron('DailyMetricsCron.refreshRecent', null).label).toBe('Refresh recent');
  });

  it('drops the Cron/Service/Listener suffix so rows do not all end in noise', () => {
    expect(describeCron('ActivityRollupCron.run', null).label).toBe('Activity rollup');
    expect(describeCron('SyncOrchestrator.run', null).label).not.toMatch(/service$/i);
  });

  it('derives a real category from the registering class', () => {
    // Everything defaulted to `maintenance`, which made the column useless.
    expect(describeCron('SmartRotationInsightsCron.run', null).category).toBe('personalization');
    expect(describeCron('PipelineTickCron.tick', null).category).toBe('pipeline');
    expect(describeCron('PythonFunctionCrons.run', null).category).toBe('llm');
    expect(describeCron('EntityPromotionCron.run', null).category).toBe('graph');
    expect(describeCron('SyncOrchestrator.orchestrateSyncJobs', null).category).toBe('import');
  });

  it('gives distinct labels to the smart-rotation family', () => {
    const names = [
      'SmartRotationInsightsCron.run',
      'SmartRotationSummariesCron.run',
      'SmartRotationGraphLinkCron.run',
      'SmartRotationQuestionFeedCron.run',
    ];
    const labels = names.map((n) => describeCron(n, null).label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('passes a UUID through rather than mangling it', () => {
    // An unnamed @Cron still registers as a UUID; there is nothing better to say,
    // and inventing a label would hide that it needs naming.
    const uuid = '007c9ac0-fb23-4203-809b-c2d100b373e4';

    expect(describeCron(uuid, null).label).toBe(uuid);
  });

  it('falls back to maintenance for an unrecognised class', () => {
    expect(describeCron('SomethingNew.run', null).category).toBe('maintenance');
  });
});
