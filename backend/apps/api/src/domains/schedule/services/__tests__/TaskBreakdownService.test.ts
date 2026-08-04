import { BadRequestException } from '@nestjs/common';

import type { RequestContext, UserServiceContext } from '@ci/common/context';
import type { LoggerService } from '@ci/common/logging';
import type { OllamaService } from '@ci/domains/llm';

import type { CreateCandidateDto } from '../../types';
import type { CandidateService } from '../CandidateService';
import { TaskBreakdownService } from '../TaskBreakdownService';

const CONTEXT = { userId: 'user-1' } as UserServiceContext & RequestContext;
const AT = new Date('2026-08-04T09:00:00.000Z');

function makeService(content: string) {
  const upserted: CreateCandidateDto[][] = [];

  const candidateService = {
    upsert: (_ctx: unknown, proposals: CreateCandidateDto[]) => {
      upserted.push(proposals);

      return Promise.resolve(proposals.map((p, i) => ({ id: `cand-${i}`, ...p })));
    },
  } as unknown as CandidateService;

  const ollamaService = {
    chat: () => Promise.resolve({ message: { role: 'assistant', content } }),
  } as unknown as OllamaService;

  const logger = { setContext() {}, log() {}, warn() {}, debug() {}, error() {} } as unknown as LoggerService;

  return {
    service: new TaskBreakdownService(candidateService, ollamaService, logger),
    upserted,
  };
}

describe('TaskBreakdownService.parseTasks', () => {
  it('reads a clean JSON response', () => {
    const tasks = TaskBreakdownService.parseTasks(
      '{"tasks":[{"title":"Book the dentist","detail":"overdue since spring","duration_minutes":15,"l0_class":"ERRAND"}]}',
    );

    expect(tasks).toEqual([
      {
        title: 'Book the dentist',
        detail: 'overdue since spring',
        duration_minutes: 15,
        l0_class: 'ERRAND',
      },
    ]);
  });

  it('survives a markdown fence and leading prose', () => {
    const tasks = TaskBreakdownService.parseTasks(
      'Sure! Here you go:\n```json\n{"tasks":[{"title":"Call Mum"}]}\n```',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Call Mum');
  });

  it('returns nothing rather than throwing on unparseable output', () => {
    expect(TaskBreakdownService.parseTasks('I could not do that')).toEqual([]);
    expect(TaskBreakdownService.parseTasks('')).toEqual([]);
    expect(TaskBreakdownService.parseTasks('{"tasks":"not an array"}')).toEqual([]);
  });

  it('drops a detail that only restates the title', () => {
    const [task] = TaskBreakdownService.parseTasks(
      '{"tasks":[{"title":"Call Mum","detail":"call mum"}]}',
    );

    expect(task.detail).toBeUndefined();
  });

  it('drops a duration outside the plausible range', () => {
    const tasks = TaskBreakdownService.parseTasks(
      '{"tasks":[{"title":"A","duration_minutes":1},{"title":"B","duration_minutes":10000},{"title":"C","duration_minutes":45}]}',
    );

    expect(tasks[0].duration_minutes).toBeUndefined();
    expect(tasks[1].duration_minutes).toBeUndefined();
    expect(tasks[2].duration_minutes).toBe(45);
  });

  it('drops an out-of-vocabulary class instead of passing it through', () => {
    // It would render as "unsorted" anyway, and this keeps an invented label out
    // of ci.events.category when the card is accepted.
    const tasks = TaskBreakdownService.parseTasks(
      '{"tasks":[{"title":"A","l0_class":"CHORES"},{"title":"B","l0_class":"UNKNOWN"},{"title":"C","l0_class":"work"}]}',
    );

    expect(tasks[0].l0_class).toBeUndefined();
    expect(tasks[1].l0_class).toBeUndefined();
    expect(tasks[2].l0_class).toBe('WORK');
  });

  it('caps the batch so a dump cannot flood the slate', () => {
    const many = Array.from({ length: 30 }, (_, i) => `{"title":"Task ${i}"}`).join(',');

    expect(TaskBreakdownService.parseTasks(`{"tasks":[${many}]}`)).toHaveLength(12);
  });

  it('skips an empty title and trims a trailing period', () => {
    const tasks = TaskBreakdownService.parseTasks(
      '{"tasks":[{"title":"   "},{"title":"Prep the deck."}]}',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Prep the deck');
  });
});

describe('TaskBreakdownService.breakDown', () => {
  it('turns each extracted task into a candidate the user owns', async () => {
    const { service, upserted } = makeService(
      '{"tasks":[{"title":"Book the dentist","detail":"overdue","l0_class":"ERRAND"},{"title":"Prep the deck"}]}',
    );

    const written = await service.breakDown(CONTEXT, 'dentist, and prep thursday deck', AT);

    expect(written).toHaveLength(2);

    const [proposals] = upserted;
    expect(proposals.map((p) => p.title)).toEqual(['Book the dentist', 'Prep the deck']);
    // The because is the user's own words — nothing reaches the slate without one.
    expect(proposals[0].rationale).toBe('You wrote: overdue');
    expect(proposals[1].rationale).toBe('You wrote this down.');
    expect(proposals[0].l0_class).toBe('ERRAND');
    expect(proposals[0].window_start).toBe(AT);
  });

  it('is idempotent for one dump and distinct across sittings', async () => {
    const json = '{"tasks":[{"title":"Call Mum"}]}';
    const { service, upserted } = makeService(json);

    await service.breakDown(CONTEXT, 'call mum', AT);
    await service.breakDown(CONTEXT, 'call mum', AT);
    await service.breakDown(CONTEXT, 'call mum', new Date(AT.getTime() + 60_000));

    expect(upserted[0][0].dedupe_key).toBe(upserted[1][0].dedupe_key);
    expect(upserted[2][0].dedupe_key).not.toBe(upserted[0][0].dedupe_key);
  });

  it('stays out of the adapter namespace so the sync sweep never retires it', async () => {
    // SuggestionSyncService retires stale `adapter/` rows whose source action was
    // dismissed. A hand-written task has no upstream source to go stale.
    const { service, upserted } = makeService('{"tasks":[{"title":"Call Mum"}]}');

    await service.breakDown(CONTEXT, 'call mum', AT);

    expect(upserted[0][0].generator).toBe('braindump/llm');
    expect(upserted[0][0].generator?.startsWith('adapter/')).toBe(false);
  });

  it('rejects empty input and an oversized paste', async () => {
    const { service } = makeService('{"tasks":[]}');

    await expect(service.breakDown(CONTEXT, '   ', AT)).rejects.toThrow(BadRequestException);
    await expect(service.breakDown(CONTEXT, 'x'.repeat(4001), AT)).rejects.toThrow(BadRequestException);
  });

  it('writes nothing when the model returns nothing usable', async () => {
    const { service, upserted } = makeService('sorry, I cannot help with that');

    await expect(service.breakDown(CONTEXT, 'something', AT)).resolves.toEqual([]);
    expect(upserted).toHaveLength(0);
  });
});
