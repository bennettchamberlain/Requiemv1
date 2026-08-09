import { ConflictException, NotFoundException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { ContextService } from '@ci/common/context';
import {
  READ_CAPABILITY,
  REQUIRE_CAPABILITY_KEY,
  REQUIRE_SCOPES_KEY,
  WRITE_CAPABILITY,
} from '@ci/common/decorators';
import { IdFormatGuard, JwtOrApiKeyAuthGuard } from '@ci/common/guards';

import { PipelineRunService } from '../../services/PipelineRunService';
import { PipelineController } from '../PipelineController';

/**
 * The operator surface, driven through a real Nest HTTP stack.
 *
 * Everything interesting about a controller lives in its wiring — the route
 * paths, the guards, the query parsing, and which exception maps to which status
 * — and none of that is exercised by calling the methods directly. So the tests
 * below go through `supertest` against a module containing this controller, a
 * `PipelineRunService` double, and the one global guard that matters
 * (`IdFormatGuard`, registered as `APP_GUARD` in `application.ts`).
 *
 * `JwtOrApiKeyAuthGuard` is overridden to always pass: whether a request is
 * authenticated is that guard's contract and it has its own tests. What IS
 * asserted here is the metadata the guard reads — every route's required
 * capability, and the deliberate ABSENCE of `@RequireScopes` — because those are
 * declarations this file owns and a missing one fails open.
 */

const USER = '00000000-0000-4000-8000-0000000000aa';
const RUN_ID = '00000000-0000-7000-8000-0000000000c1';
const LETTER_ID = '00000000-0000-7000-8000-0000000000d1';

class AlwaysAllowGuard {
  canActivate = () => true;
}

function makeService() {
  return {
    stageState: jest.fn(async () => [
      {
        stage: 'enrich.media_dimensions',
        stageVersion: 1,
        total: 10,
        done: 8,
        skipped: 1,
        failed: 1,
        pending: 0,
        running: 0,
        quarantined: 0,
        stale: 2,
        coverage: 0.9,
      },
    ]),
    listRuns: jest.fn(async () => []),
    getRun: jest.fn(async () => ({
      id: RUN_ID,
      kind: 'reprocess',
      desiredState: 'running' as const,
      status: 'running',
      startedAt: new Date('2026-08-09T10:00:00Z'),
      finishedAt: null,
      active: true,
      detail: {},
      shardCount: 1,
      shardsByStatus: { running: 1 },
      shards: [],
      shardsTruncated: false,
    })),
    setDesiredState: jest.fn(async () => ({
      id: RUN_ID,
      kind: 'reprocess',
      desiredState: 'paused' as const,
      status: 'running',
      startedAt: new Date('2026-08-09T10:00:00Z'),
      finishedAt: null,
      active: true,
      detail: {},
      shardCount: 0,
      shardsByStatus: {},
    })),
    listDeadLetters: jest.fn(async () => []),
    replayDeadLetter: jest.fn(async () => ({
      id: LETTER_ID,
      eventName: 'pipeline.slice',
      queue: 'pipeline-enrich',
      jobIds: ['job-1'],
      replayedAt: new Date('2026-08-09T12:00:00Z'),
    })),
  };
}

describe('PipelineController', () => {
  let app: INestApplication;
  let service: ReturnType<typeof makeService>;

  beforeEach(async () => {
    service = makeService();

    const module = await Test.createTestingModule({
      controllers: [PipelineController],
      providers: [
        { provide: PipelineRunService, useValue: service },
        { provide: APP_GUARD, useClass: IdFormatGuard },
      ],
    })
      .overrideGuard(JwtOrApiKeyAuthGuard)
      .useClass(AlwaysAllowGuard)
      .compile();

    app = module.createNestApplication();

    // Stands in for RequestContextMiddleware: `@Context()` reads the request
    // context out of AsyncLocalStorage, and `toServiceContext` 401s without a
    // userId in it.
    app.use((_req: Request, _res: Response, next: NextFunction) => {
      ContextService.run({ traceId: 'test-trace', userId: USER }, () => next());
    });

    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // -------------------------------------------------------------------------
  // GET /api/pipeline/state
  // -------------------------------------------------------------------------

  describe('GET /api/pipeline/state', () => {
    it('answers "is my import finished?" per stage, scoped to the caller', async () => {
      const response = await request(app.getHttpServer()).get('/api/pipeline/state').expect(200);

      expect(response.body.stages).toHaveLength(1);
      expect(response.body.stages[0]).toMatchObject({
        stage: 'enrich.media_dimensions',
        stageVersion: 1,
        done: 8,
        skipped: 1,
        failed: 1,
        pending: 0,
        stale: 2,
      });
      expect(service.stageState).toHaveBeenCalledWith({ userId: USER });
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/pipeline/runs
  // -------------------------------------------------------------------------

  describe('GET /api/pipeline/runs', () => {
    it('passes limit and offset through', async () => {
      await request(app.getHttpServer()).get('/api/pipeline/runs?limit=5&offset=10').expect(200);

      expect(service.listRuns).toHaveBeenCalledWith(
        { userId: USER },
        { limit: 5, offset: 10, activeOnly: undefined },
      );
    });

    it('reads ?activeOnly=false as FALSE', async () => {
      // The reason `queryBoolean` exists. `z.coerce.boolean()` is `Boolean(value)`,
      // and `Boolean('false')` is `true` — so the naive schema would filter to
      // active runs only when asked for the opposite. This is the assertion that
      // stops somebody "simplifying" it back.
      await request(app.getHttpServer()).get('/api/pipeline/runs?activeOnly=false').expect(200);

      expect(service.listRuns).toHaveBeenCalledWith(
        { userId: USER },
        expect.objectContaining({ activeOnly: false }),
      );
    });

    it('reads ?activeOnly=true as TRUE', async () => {
      await request(app.getHttpServer()).get('/api/pipeline/runs?activeOnly=true').expect(200);

      expect(service.listRuns).toHaveBeenCalledWith(
        { userId: USER },
        expect.objectContaining({ activeOnly: true }),
      );
    });

    it('400s a limit outside the accepted range instead of clamping silently', async () => {
      await request(app.getHttpServer()).get('/api/pipeline/runs?limit=0').expect(400);
      await request(app.getHttpServer()).get('/api/pipeline/runs?limit=100000').expect(400);

      expect(service.listRuns).not.toHaveBeenCalled();
    });

    it('400s a boolean it cannot read rather than guessing', async () => {
      await request(app.getHttpServer()).get('/api/pipeline/runs?activeOnly=yes').expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/pipeline/runs/:id
  // -------------------------------------------------------------------------

  describe('GET /api/pipeline/runs/:id', () => {
    it('returns the run with its shard progress', async () => {
      const response = await request(app.getHttpServer()).get(`/api/pipeline/runs/${RUN_ID}`).expect(200);

      expect(response.body).toMatchObject({ id: RUN_ID, active: true, shardCount: 1 });
      expect(service.getRun).toHaveBeenCalledWith({ userId: USER }, RUN_ID);
    });

    it('404s a malformed id before it reaches a ::uuid cast', async () => {
      // IdFormatGuard is a global APP_GUARD, which is why this controller does
      // not validate `:id` itself.
      await request(app.getHttpServer()).get('/api/pipeline/runs/not-a-uuid').expect(404);

      expect(service.getRun).not.toHaveBeenCalled();
    });

    it('surfaces the service 404 as a 404', async () => {
      service.getRun.mockRejectedValueOnce(new NotFoundException('nope'));

      await request(app.getHttpServer()).get(`/api/pipeline/runs/${RUN_ID}`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Control
  // -------------------------------------------------------------------------

  describe('run control', () => {
    it.each([
      ['pause', 'paused'],
      ['resume', 'running'],
      ['cancel', 'cancelled'],
    ])('POST /runs/:id/%s writes desired_state %s', async (action, desired) => {
      // 200, not 201: these create nothing. They record an intent a worker
      // reconciles toward between batches.
      await request(app.getHttpServer()).post(`/api/pipeline/runs/${RUN_ID}/${action}`).expect(200);

      expect(service.setDesiredState).toHaveBeenCalledWith({ userId: USER }, RUN_ID, desired);
    });

    it('409s when the run can no longer accept control changes', async () => {
      service.setDesiredState.mockRejectedValueOnce(new ConflictException('already finished'));

      await request(app.getHttpServer()).post(`/api/pipeline/runs/${RUN_ID}/pause`).expect(409);
    });

    it('404s an unknown run', async () => {
      service.setDesiredState.mockRejectedValueOnce(new NotFoundException('nope'));

      await request(app.getHttpServer()).post(`/api/pipeline/runs/${RUN_ID}/cancel`).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // Dead letters
  // -------------------------------------------------------------------------

  describe('GET /api/pipeline/dead-letters', () => {
    it('passes the queue, stage and replayed filters through', async () => {
      await request(app.getHttpServer())
        .get('/api/pipeline/dead-letters?queue=pipeline-embed&stage=index.embed&replayed=false&limit=10')
        .expect(200);

      expect(service.listDeadLetters).toHaveBeenCalledWith(
        { userId: USER },
        { queue: 'pipeline-embed', stage: 'index.embed', replayed: false, limit: 10, offset: undefined },
      );
    });

    it('defaults every filter to absent', async () => {
      await request(app.getHttpServer()).get('/api/pipeline/dead-letters').expect(200);

      expect(service.listDeadLetters).toHaveBeenCalledWith(
        { userId: USER },
        { queue: undefined, stage: undefined, replayed: undefined, limit: undefined, offset: undefined },
      );
    });

    it('400s a page larger than the ceiling', async () => {
      // Small on purpose: every row carries its payload verbatim and its full
      // error with stack.
      await request(app.getHttpServer()).get('/api/pipeline/dead-letters?limit=201').expect(400);
    });
  });

  describe('POST /api/pipeline/dead-letters/:id/replay', () => {
    it('reports what was re-emitted', async () => {
      const response = await request(app.getHttpServer())
        .post(`/api/pipeline/dead-letters/${LETTER_ID}/replay`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: LETTER_ID,
        eventName: 'pipeline.slice',
        queue: 'pipeline-enrich',
        jobIds: ['job-1'],
      });
      expect(service.replayDeadLetter).toHaveBeenCalledWith({ userId: USER }, LETTER_ID);
    });

    it('409s a letter that was already replayed', async () => {
      service.replayDeadLetter.mockRejectedValueOnce(new ConflictException('already replayed'));

      await request(app.getHttpServer()).post(`/api/pipeline/dead-letters/${LETTER_ID}/replay`).expect(409);
    });

    it('404s a malformed letter id', async () => {
      await request(app.getHttpServer()).post('/api/pipeline/dead-letters/nope/replay').expect(404);

      expect(service.replayDeadLetter).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Auth declarations
  //
  // These are metadata assertions rather than request assertions because the
  // guard that reads them is overridden above. They still belong here: the
  // declarations are this file's, and every one of them fails OPEN if forgotten.
  // -------------------------------------------------------------------------

  describe('auth declarations', () => {
    const handler = (name: keyof PipelineController) =>
      PipelineController.prototype[name] as unknown as object;

    it('guards the whole controller with JwtOrApiKeyAuthGuard', () => {
      const guards = Reflect.getMetadata('__guards__', PipelineController) as unknown[];

      expect(guards).toContain(JwtOrApiKeyAuthGuard);
    });

    it.each(['getState', 'listRuns', 'getRun', 'listDeadLetters'] as const)(
      '%s requires only read capability',
      (name) => {
        expect(Reflect.getMetadata(REQUIRE_CAPABILITY_KEY, handler(name))).toBe(READ_CAPABILITY);
      },
    );

    it.each(['pauseRun', 'resumeRun', 'cancelRun', 'replayDeadLetter'] as const)(
      '%s requires write capability, so a read-only key cannot steer a run',
      (name) => {
        expect(Reflect.getMetadata(REQUIRE_CAPABILITY_KEY, handler(name))).toBe(WRITE_CAPABILITY);
      },
    );

    it('declares no scopes, so a scope-limited api key cannot reach the control plane', () => {
      // Scope enforcement is deny-by-default: a scope-limited key is confined to
      // routes that explicitly grant one of its scopes, and this controller
      // grants none. Adding @RequireScopes here would OPEN it up, not lock it
      // down — which is the opposite of what the decorator's name suggests.
      expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, PipelineController)).toBeUndefined();

      for (const name of [
        'getState',
        'listRuns',
        'getRun',
        'pauseRun',
        'resumeRun',
        'cancelRun',
        'listDeadLetters',
        'replayDeadLetter',
      ] as const) {
        expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, handler(name))).toBeUndefined();
      }
    });
  });
});
