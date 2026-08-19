import { DETERMINISTIC_EDGE_RULES } from '@ci/domains/maintenance';

import { STAGE_ID_LIST, STAGE_IDS } from '../../constants';
import { EDGE_STAGES_BY_SOURCE, GraphEdgeSweepRequestListener } from '../GraphEdgeSweepRequestListener';

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeListener() {
  const dispatchService = { startSweep: jest.fn(async () => undefined) };
  const logger = makeLogger();
  const listener = new GraphEdgeSweepRequestListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatchService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { listener, dispatchService, logger };
}

const USER = '00000000-0000-0000-0000-0000000000aa';

describe('EDGE_STAGES_BY_SOURCE', () => {
  it('maps every source to a declared stage id', () => {
    for (const stage of Object.values(EDGE_STAGES_BY_SOURCE)) {
      expect(STAGE_ID_LIST).toContain(stage);
    }
  });

  it('covers every source the deterministic-edge matrix declares', () => {
    // THE DRIFT THIS CATCHES. A rule added to the matrix over a new table is a
    // source no kick can name, so its edges wait for the scheduled sweep with
    // nothing anywhere saying so. The matrix is the authority; this map has to
    // keep up with it, not the other way round.
    const matrixSources = new Set(DETERMINISTIC_EDGE_RULES.map((rule) => rule.source));

    for (const source of matrixSources) {
      expect(Object.keys(EDGE_STAGES_BY_SOURCE)).toContain(source);
    }
  });
});

describe('GraphEdgeSweepRequestListener', () => {
  it('starts one user-scoped sweep per requested source', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({
      userId: USER,
      sources: ['communications', 'content'],
      requestedBy: 'import-run:r1',
    });

    expect(dispatchService.startSweep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      { stage: STAGE_IDS.PROMOTE_EDGE_COMMUNICATION, userId: USER },
      { stage: STAGE_IDS.PROMOTE_EDGE_CONTENT, userId: USER },
    ]);
  });

  it('sweeps every edge source when the payload names no scope', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER });

    expect(dispatchService.startSweep).toHaveBeenCalledTimes(Object.keys(EDGE_STAGES_BY_SOURCE).length);
  });

  it('drops unknown sources but sweeps the known remainder', async () => {
    const { listener, dispatchService, logger } = makeListener();

    await listener.handleRequest({ userId: USER, sources: ['events', 'not-a-source'] });

    expect(
      dispatchService.startSweep.mock.calls.map((call) => (call as { stage: string }[])[0].stage),
    ).toEqual([STAGE_IDS.PROMOTE_EDGE_EVENT]);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('refuses (rather than widens to a full pass) a scope naming ONLY unknown sources', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER, sources: ['bogus'] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
  });

  it('an empty scope array is a refusal too, not a full pass', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER, sources: [] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
  });

  it('refuses a request without a userId — sweeps are user-scoped by design', async () => {
    const { listener, dispatchService, logger } = makeListener();

    await listener.handleRequest({ sources: ['communications'] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
