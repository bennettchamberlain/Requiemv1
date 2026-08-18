import { BadRequestException } from '@nestjs/common';

import { bulkInsertIdempotent } from '@ci/common/persistence';

import { ItemBaseEntity } from '../../entities/ItemBaseEntity';
import { ItemEntity } from '../../entities/ItemEntity';

import { ITEM_HARNESS_CONTEXT, ITEM_HARNESS_USER, makeItemHarness } from './harness/itemServiceHarness';

jest.mock('@ci/common/persistence', () => ({
  ...jest.requireActual('@ci/common/persistence'),
  bulkInsertIdempotent: jest.fn(),
}));

const bulkInsertMock = bulkInsertIdempotent as jest.Mock;

const CONTEXT = ITEM_HARNESS_CONTEXT;

beforeEach(() => {
  bulkInsertMock.mockReset();
});

/**
 * The service's contract for physical properties: every write path resolves
 * units through the same normalizer, and unresolvable input is the caller's
 * error rather than a constraint violation from inside the transaction.
 *
 * The conversions themselves are proven in `physicalProperties.test.ts`; what
 * matters here is that all three write paths actually go through them.
 */
describe('ItemService physical properties on create', () => {
  it('stores canonical SI whatever unit the caller used', async () => {
    const { service, detailRepo } = makeItemHarness();

    await service.create(CONTEXT, {
      name: 'Camera bag',
      lengthMm: '12 in',
      massG: '2.5 lb',
      volumeMl: '1 l',
      colors: 'Navy, Off White',
      materials: ['Leather'],
      colorHex: '#123ABC',
      acquisitionMethod: 'bought',
      unitSystem: 'imperial',
    });

    expect(detailRepo.create).toHaveBeenCalledTimes(1);
    expect(detailRepo.create.mock.calls[0]?.[0]).toMatchObject({
      lengthMm: 304.8,
      massG: 1133.981,
      volumeMl: 1000,
      colors: ['navy', 'off white'],
      materials: ['leather'],
      colorHex: '#123abc',
      acquisitionMethod: 'purchased',
      unitSystem: 'imperial',
    });
  });

  it('derives the materials a composition names, so the two columns cannot disagree', async () => {
    const { service, detailRepo } = makeItemHarness();

    await service.create(CONTEXT, {
      name: 'Jacket',
      materials: ['cotton'],
      composition: { cotton: 80, elastane: 20 },
    });

    expect(detailRepo.create.mock.calls[0]?.[0]).toMatchObject({
      materials: ['cotton', 'elastane'],
      composition: { cotton: 0.8, elastane: 0.2 },
    });
  });

  it('rejects an unreadable measurement as a 400 rather than letting the CHECK fail', async () => {
    const { service, detailRepo } = makeItemHarness();

    await expect(service.create(CONTEXT, { name: 'Mug', massG: 'heavy' })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    // Nothing was written — the rejection happens before the transaction.
    expect(detailRepo.save).not.toHaveBeenCalled();
  });

  it('rejects a zero measurement, which means unmeasured rather than weightless', async () => {
    const { service } = makeItemHarness();

    await expect(service.create(CONTEXT, { name: 'Mug', massG: 0 })).rejects.toThrow(/greater than zero/);
  });

  it('refuses to give a digital item a body', async () => {
    const { service } = makeItemHarness();

    await expect(service.create(CONTEXT, { name: 'Ebook', isDigital: true, massG: 200 })).rejects.toThrow(
      /no physical body/,
    );
  });

  it('records an inferred identity honestly instead of the ground-truth default', async () => {
    const { service, detailRepo } = makeItemHarness();

    await service.create(CONTEXT, { name: 'Mug', identityMethod: 'vision', identityConfidence: 0.4 });

    expect(detailRepo.create.mock.calls[0]?.[0]).toMatchObject({
      identityMethod: 'vision',
      identityConfidence: 0.4,
    });
  });

  it('rejects a confidence the CHECK constraint would reject', async () => {
    const { service } = makeItemHarness();

    await expect(service.create(CONTEXT, { name: 'Mug', identityConfidence: 1.5 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a fractional quantity', async () => {
    const { service } = makeItemHarness();

    await expect(service.create(CONTEXT, { name: 'Mug', quantity: 0 })).rejects.toThrow(/whole number/);
  });
});

describe('ItemService physical properties on bulk ingest', () => {
  it('canonicalizes every row the same way the single-row path does', async () => {
    const { service, detailRepo } = makeItemHarness();

    bulkInsertMock.mockResolvedValue([]);

    await service.createMany(CONTEXT, [
      { id: 'i1', name: 'Chair', dimensions: '80 x 45 x 45 cm', massG: '6 kg' },
    ]);

    expect(detailRepo.create.mock.calls[0]?.[0]).toMatchObject({
      lengthMm: 800,
      widthMm: 450,
      heightMm: 450,
      massG: 6000,
    });
  });

  it('rejects the batch — before any insert — when a row cannot be canonicalized', async () => {
    const { service } = makeItemHarness();

    await expect(
      service.createMany(CONTEXT, [
        { id: 'i1', name: 'Chair', massG: '6 kg' },
        { id: 'i2', name: 'Desk', massG: '40 stones and a bit' },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(bulkInsertMock).not.toHaveBeenCalled();
  });
});

describe('ItemService physical properties on update', () => {
  it('patches only the properties the caller mentioned', async () => {
    const { service, detailRepo, baseRepo } = makeItemHarness();

    detailRepo.findOne.mockResolvedValue(
      Object.assign(new ItemEntity(), { id: 'i1', userId: ITEM_HARNESS_USER }),
    );
    baseRepo.find.mockResolvedValue([Object.assign(new ItemBaseEntity(), { id: 'i1', name: 'Chair' })]);

    await service.update(CONTEXT, 'i1', { massG: '6 kg' });

    const patch = (detailRepo.update.mock.calls[0] as unknown[])[1] as Record<string, unknown>;

    expect(patch).toMatchObject({ massG: 6000 });
    expect(patch).not.toHaveProperty('lengthMm');
    expect(patch).not.toHaveProperty('colors');
  });

  it('refuses to mark an item digital while it still has a body', async () => {
    const { service, detailRepo } = makeItemHarness();

    detailRepo.findOne.mockResolvedValue(
      Object.assign(new ItemEntity(), { id: 'i1', userId: ITEM_HARNESS_USER, massG: 6000 }),
    );

    await expect(service.update(CONTEXT, 'i1', { isDigital: true })).rejects.toThrow(/still has massG/);
    expect(detailRepo.update).not.toHaveBeenCalled();
  });

  it('allows the flip when the same patch clears the measurements', async () => {
    const { service, detailRepo, baseRepo } = makeItemHarness();

    detailRepo.findOne.mockResolvedValue(
      Object.assign(new ItemEntity(), { id: 'i1', userId: ITEM_HARNESS_USER, massG: 6000 }),
    );
    baseRepo.find.mockResolvedValue([Object.assign(new ItemBaseEntity(), { id: 'i1', name: 'Ebook' })]);

    await service.update(CONTEXT, 'i1', { isDigital: true, massG: null });

    expect((detailRepo.update.mock.calls[0] as unknown[])[1]).toMatchObject({
      isDigital: true,
      massG: null,
    });
  });

  it('clears a property when the caller explicitly sends null', async () => {
    const { service, detailRepo, baseRepo } = makeItemHarness();

    detailRepo.findOne.mockResolvedValue(
      Object.assign(new ItemEntity(), { id: 'i1', userId: ITEM_HARNESS_USER }),
    );
    baseRepo.find.mockResolvedValue([Object.assign(new ItemBaseEntity(), { id: 'i1', name: 'Chair' })]);

    await service.update(CONTEXT, 'i1', { massG: null, colors: null, acquiredAt: null });

    expect((detailRepo.update.mock.calls[0] as unknown[])[1]).toMatchObject({
      massG: null,
      colors: null,
      acquiredAt: null,
    });
  });
});
