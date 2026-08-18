import type { CreateObjectObservationDto } from '@ci/domains/memory';

import { InventoryListener } from '../InventoryListener';

/**
 * `InventoryListener` — the path the observation table was written to fix.
 *
 * `ci.object_observations`' migration header names this class by name: it
 * "writes speculative ci.inventory rows straight from a vision guess",
 * conflating "a coffee mug is visible in this photo" with "I own this specific
 * coffee mug".
 *
 * What changed, and what deliberately did not:
 *
 *  - The minting STAYS. This listener only runs when the upload carried
 *    `inventoryCapture: true` — an explicit per-upload assertion by the user
 *    that they are cataloguing their own belongings. The intent to own is real;
 *    it is the model's item-by-item reading of the photo that is a guess.
 *  - The guess is now RECORDED. Every item becomes a sighting first, and the
 *    minted row is attached to it as a resolution, so there is an auditable
 *    trail from pixels to owned unit where before an inventory row simply
 *    appeared.
 *
 * These tests are the witness for the second half.
 */

const FILE = 'file-1';
const USER = 'user-1';

const ANALYSIS = JSON.stringify({
  items: [
    {
      name: 'Coffee Mug',
      description: 'White ceramic mug',
      category: 'Kitchenware',
      brand: null,
      model: null,
      condition: 'good',
      estimated_value: 8,
    },
    {
      name: 'Desk Lamp',
      description: 'Anglepoise-style lamp',
      category: 'Lighting',
      brand: 'IKEA',
      model: null,
      condition: 'fair',
      estimated_value: 25,
    },
  ],
});

function makeListener(opts: { content?: string; externalCreatedAt?: Date | null } = {}) {
  const { content = ANALYSIS, externalCreatedAt = null } = opts;

  const fileService = {
    findById: jest.fn(async () => ({
      id: FILE,
      contentType: 'image/jpeg',
      key: 'key-1',
      createdAt: new Date('2026-05-01T09:00:00.000Z'),
      externalCreatedAt,
    })),
    getFileContent: jest.fn(async () => Buffer.from('pixels')),
  };

  const ollamaService = {
    chat: jest.fn(async () => ({ message: { content } })),
  };

  const itemService = {
    create: jest.fn(async (_ctx: unknown, dto: { name: string }) => ({
      id: `item-${dto.name.replace(/\s+/g, '-').toLowerCase()}`,
      name: dto.name,
    })),
  };

  const observationService = {
    create: jest.fn(
      async (_ctx: unknown, dto: CreateObjectObservationDto): Promise<{ id: string } | null> => ({
        id: `obs-${dto.label.replace(/\s+/g, '-').toLowerCase()}`,
      }),
    ),
    resolve: jest.fn(async () => ({})),
  };

  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const listener = new InventoryListener(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fileService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ollamaService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    itemService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    observationService as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    logger as any,
  );

  return { listener, fileService, ollamaService, itemService, observationService, logger };
}

function upload(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER,
    fileId: FILE,
    inventoryCapture: true,
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('InventoryListener — a vision guess is recorded as a sighting', () => {
  it('records one sighting per identified item', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    expect(observationService.create).toHaveBeenCalledTimes(2);
    expect(observationService.create.mock.calls.map((call) => call[1].label)).toEqual([
      'Coffee Mug',
      'Desk Lamp',
    ]);
  });

  it('records the sighting BEFORE minting the owned unit', async () => {
    const { listener, observationService, itemService } = makeListener();

    const order: string[] = [];

    observationService.create.mockImplementation(async (_ctx: unknown, dto: CreateObjectObservationDto) => {
      order.push(`observe:${dto.label}`);

      return { id: `obs-${dto.label}` };
    });
    itemService.create.mockImplementation(async (_ctx: unknown, dto: { name: string }) => {
      order.push(`mint:${dto.name}`);

      return { id: `item-${dto.name}`, name: dto.name };
    });

    await listener.handleFileUploaded(upload());

    // The weak claim is on the record before the strong one is made, so a crash
    // between them leaves a sighting with no owner rather than an owned unit
    // with no evidence.
    expect(order[0]).toBe('observe:Coffee Mug');
    expect(order[1]).toBe('mint:Coffee Mug');
  });

  it('attaches the minted unit to the sighting as a resolution', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    expect(observationService.resolve).toHaveBeenCalledWith(
      expect.anything(),
      'obs-coffee-mug',
      // `label` is the honest method: nothing matched an identifier or an
      // embedding, the model read a name off a photo.
      { resolvedObjectId: 'item-coffee-mug', resolutionMethod: 'label', resolutionConfidence: null },
    );
  });

  it('NEVER invents a detection confidence', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    // The prompt asks for no score. A number made up here would outrank a
    // genuinely measured one later.
    expect(observationService.create.mock.calls[0][1].detectionConfidence).toBeNull();
  });

  it('names the model as the detector, so the sighting says who spoke', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload({ model: 'llava:13b' }));

    expect(observationService.create.mock.calls[0][1]).toEqual(
      expect.objectContaining({ labelSource: 'ollama_vision', detector: 'llava:13b', fileId: FILE }),
    );
  });

  it('carries the observed state into attributes', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    expect(observationService.create.mock.calls[1][1].attributes).toEqual({
      condition: 'fair',
      category: 'Lighting',
    });
  });

  it('dates the sighting from the capture time, not the time the job ran', async () => {
    const { listener, observationService } = makeListener({
      externalCreatedAt: new Date('2018-03-09T08:00:00.000Z'),
    });

    await listener.handleFileUploaded(upload());

    expect(observationService.create.mock.calls[0][1].observedAt).toEqual(
      new Date('2018-03-09T08:00:00.000Z'),
    );
  });

  it('falls back to the upload time when there is no capture time', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    expect(observationService.create.mock.calls[0][1].observedAt).toEqual(
      new Date('2026-05-01T09:00:00.000Z'),
    );
  });

  it('sets no resolution on the way in — that is a separate call', async () => {
    const { listener, observationService } = makeListener();

    await listener.handleFileUploaded(upload());

    const dto = observationService.create.mock.calls[0][1];

    expect(dto).not.toHaveProperty('resolvedObjectId');
    expect(dto).not.toHaveProperty('resolutionMethod');
    expect(dto).not.toHaveProperty('confirmedByUser');
  });

  it('still mints when the sighting matched a human-confirmed row', async () => {
    const { listener, observationService, itemService } = makeListener();

    // `create` returns null when the row is protected; that row's resolution
    // belongs to the person who made it, so there is nothing to attach.
    observationService.create.mockResolvedValue(null);

    await listener.handleFileUploaded(upload());

    expect(itemService.create).toHaveBeenCalledTimes(2);
    expect(observationService.resolve).not.toHaveBeenCalled();
  });

  it('does nothing at all without the explicit inventory-capture opt-in', async () => {
    const { listener, observationService, itemService, fileService } = makeListener();

    await listener.handleFileUploaded(upload({ inventoryCapture: false }));

    // The user's assertion of ownership is what makes minting legitimate; with
    // no assertion there is no capture at all, and so no sighting either.
    expect(fileService.findById).not.toHaveBeenCalled();
    expect(observationService.create).not.toHaveBeenCalled();
    expect(itemService.create).not.toHaveBeenCalled();
  });

  it('records nothing when the model finds nothing', async () => {
    const { listener, observationService, itemService } = makeListener({
      content: JSON.stringify({ items: [] }),
    });

    await listener.handleFileUploaded(upload());

    expect(observationService.create).not.toHaveBeenCalled();
    expect(itemService.create).not.toHaveBeenCalled();
  });

  it('records nothing when the model returns unparseable output', async () => {
    const { listener, observationService, itemService } = makeListener({
      content: 'I am afraid I cannot do that.',
    });

    await listener.handleFileUploaded(upload());

    expect(observationService.create).not.toHaveBeenCalled();
    expect(itemService.create).not.toHaveBeenCalled();
  });
});
