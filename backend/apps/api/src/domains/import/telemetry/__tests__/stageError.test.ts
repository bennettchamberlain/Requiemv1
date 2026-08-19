import {
  describeStageFailure,
  StageContextError,
  stageFailureContext,
  withStageContext,
} from '../stageError';

/**
 * A failure that names nothing is unactionable, and until now that was every
 * import failure: `ImportStageListener` recorded `(err as Error).message` and
 * nothing else. On the live QA corpus a parse failure would have been reported,
 * in full, as "ENOENT: no such file or directory" — over 703,956 items, 56
 * parser passes and 13 data sources, with the scratch tree that held the answer
 * reclaimed the moment the run ended.
 *
 * What is under test is that the context reaches BOTH consumers: the one-line
 * `error` column a person greps, and the structured `failure` an agent reads
 * without parsing prose.
 */

describe('withStageContext', () => {
  it('names what the stage was working on, and keeps the original message', async () => {
    const work = withStageContext(
      {
        stage: 'parse',
        phase: 'parsing google_photos (7/13)',
        dataSource: 'google_photos',
        file: 'Takeout/Google Photos',
      },
      async () => {
        throw new Error('ENOENT: no such file or directory');
      },
    );

    await expect(work).rejects.toThrow(StageContextError);

    const err = await work.catch((e: unknown) => e);

    expect(describeStageFailure(err)).toBe(
      'parse [phase=parsing google_photos (7/13) dataSource=google_photos file=Takeout/Google Photos] ' +
        'ENOENT: no such file or directory',
    );
  });

  it('preserves the original error as `cause`, so a caller can still switch on its type', async () => {
    class DatabaseVolumeFullError extends Error {}

    const original = new DatabaseVolumeFullError('no space left on device');
    const err = await withStageContext({ stage: 'push', destination: 'events' }, async () => {
      throw original;
    }).catch((e: unknown) => e);

    expect((err as StageContextError).cause).toBe(original);
    // And the class name survives into the structured half, where it reads very
    // differently from a bare `Error`.
    expect(stageFailureContext(err).name).toBe('DatabaseVolumeFullError');
  });

  it('lets an inner frame refine an outer one without erasing it', async () => {
    // The push knows the destination and the batch; the row loop inside it
    // knows which row. Both are worth having, and the specific one must win.
    const err = await withStageContext({ stage: 'push', destination: 'communications', batchSize: 500 }, () =>
      withStageContext({ stagedItemId: 'abc-123' }, async () => {
        throw new Error('invalid byte sequence for encoding UTF8');
      }),
    ).catch((e: unknown) => e);

    expect(stageFailureContext(err)).toMatchObject({
      stage: 'push',
      destination: 'communications',
      batchSize: 500,
      stagedItemId: 'abc-123',
      message: 'invalid byte sequence for encoding UTF8',
    });
  });

  it('passes a successful result straight through', async () => {
    await expect(withStageContext({ stage: 'unpack' }, async () => 42)).resolves.toBe(42);
  });
});

describe('stageFailureContext', () => {
  it('yields the structured facts an agent reads without regexing prose', async () => {
    const err = await withStageContext(
      { stage: 'media', file: 'Google Photos/IMG_0042.HEIC', stagedItemId: 'row-9' },
      async () => {
        throw new Error('object store refused the upload');
      },
    ).catch((e: unknown) => e);

    expect(stageFailureContext(err)).toEqual({
      stage: 'media',
      file: 'Google Photos/IMG_0042.HEIC',
      stagedItemId: 'row-9',
      name: 'Error',
      message: 'object store refused the upload',
    });
  });

  it('degrades to exactly what the system recorded before, for an unwrapped error', () => {
    // Adopting this at every call site is not a precondition for it being
    // useful at any of them: an error that never met withStageContext still
    // produces the message it always did, plus whatever the caller knows.
    expect(stageFailureContext(new TypeError('x is not a function'), { stage: 'push' })).toEqual({
      stage: 'push',
      name: 'TypeError',
      message: 'x is not a function',
    });
  });

  it('survives a thrown non-Error, which real drivers do throw', () => {
    expect(stageFailureContext('connection terminated')).toMatchObject({
      message: 'connection terminated',
    });
  });
});

describe('describeStageFailure', () => {
  it('is a single line, because it is copied onto the run and rendered in a list', () => {
    const err = new Error(`multi\nline\nfailure`);
    const line = describeStageFailure(
      new StageContextError({ stage: 'parse', file: 'a\n  weird\tname.json' }, err),
    );

    expect(line).toContain('file=a weird name.json');
  });

  it('is bounded, so a 60kB Postgres error cannot land in a table cell', () => {
    const line = describeStageFailure(new Error('x'.repeat(50_000)));

    expect(line.length).toBeLessThanOrEqual(1_000);
  });

  it('says nothing extra when the stage knew nothing about what it was doing', () => {
    expect(describeStageFailure(new Error('boom'))).toBe('boom');
  });
});
