import { STAGE_ID_LIST, STAGE_IDS } from '../../constants';
import { INDEX_STAGES_BY_ENTITY_TYPE, SearchIndexSweepRequestListener } from '../SearchIndexSweepRequestListener';

function makeLogger() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeListener() {
  const dispatchService = { startSweep: jest.fn(async () => undefined) };
  const logger = makeLogger();
  const listener = new SearchIndexSweepRequestListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatchService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { listener, dispatchService, logger };
}

const USER = '00000000-0000-0000-0000-0000000000aa';

describe('INDEX_STAGES_BY_ENTITY_TYPE', () => {
  it('maps every type to declared stage ids', () => {
    for (const [embed, vector] of Object.values(INDEX_STAGES_BY_ENTITY_TYPE)) {
      expect(STAGE_ID_LIST).toContain(embed);
      expect(STAGE_ID_LIST).toContain(vector);
    }
  });

  it('routes content to the original index.embed / index.vector pair', () => {
    expect(INDEX_STAGES_BY_ENTITY_TYPE.content).toEqual([STAGE_IDS.INDEX_EMBED, STAGE_IDS.INDEX_VECTOR]);
  });
});

describe('SearchIndexSweepRequestListener', () => {
  it('starts a user-scoped embed + vector sweep per requested type', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({
      userId: USER,
      entityTypes: ['communication', 'person'],
      requestedBy: 'import-run:r1',
    });

    expect(dispatchService.startSweep.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      { stage: STAGE_IDS.INDEX_EMBED_COMMUNICATION, userId: USER },
      { stage: STAGE_IDS.INDEX_VECTOR_COMMUNICATION, userId: USER },
      { stage: STAGE_IDS.INDEX_EMBED_PERSON, userId: USER },
      { stage: STAGE_IDS.INDEX_VECTOR_PERSON, userId: USER },
    ]);
  });

  it('sweeps every indexable type when the payload names no scope', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER });

    // Two sweeps (embed + vector) per mapped type.
    expect(dispatchService.startSweep).toHaveBeenCalledTimes(
      Object.keys(INDEX_STAGES_BY_ENTITY_TYPE).length * 2,
    );
  });

  it('drops unknown entity types but sweeps the known remainder', async () => {
    const { listener, dispatchService, logger } = makeListener();

    await listener.handleRequest({ userId: USER, entityTypes: ['event', 'not-a-type'] });

    expect(dispatchService.startSweep.mock.calls.map((call) => (call as { stage: string }[])[0].stage)).toEqual(
      [STAGE_IDS.INDEX_EMBED_EVENT, STAGE_IDS.INDEX_VECTOR_EVENT],
    );
    expect(logger.warn).toHaveBeenCalled();
  });

  it('refuses (rather than widens to a full pass) a scope naming ONLY unknown types', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER, entityTypes: ['bogus'] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
  });

  it('an empty scope array is a refusal too, not a full pass', async () => {
    const { listener, dispatchService } = makeListener();

    await listener.handleRequest({ userId: USER, entityTypes: [] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
  });

  it('refuses a request without a userId — sweeps are user-scoped by design', async () => {
    const { listener, dispatchService, logger } = makeListener();

    await listener.handleRequest({ entityTypes: ['communication'] });

    expect(dispatchService.startSweep).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
