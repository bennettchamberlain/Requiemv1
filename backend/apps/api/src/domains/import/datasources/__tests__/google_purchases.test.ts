import path from 'node:path';

import { GooglePurchasesFileImporter } from '../google_purchases';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';
import { metaText } from './support/emitted';

const ROOT = path.join(__dirname, 'fixtures', 'google_purchases', 'Purchases & Reservations');

async function run() {
  const fi = new GooglePurchasesFileImporter();
  const pipeline: EmittedGraph[] = [];
  await fi.fileImport({}, { filename: 'Purchases & Reservations', fullPath: ROOT }, {
    pipeline,
    timeframe: {},
    log: () => {},
  } as unknown as ImportParams);

  return pipeline.filter((p) => p.item).map((p) => p.item);
}

describe('Google Purchases & Reservations datasource', () => {
  it('recognizes the directory tree', async () => {
    const fi = new GooglePurchasesFileImporter();
    const rec = await fi.recognize({}, { filename: 'Purchases & Reservations', fullPath: ROOT });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('produces items with correct classifications', async () => {
    const items = await run();
    expect(items.length).toBe(2);
    const reservation = items.find((i) => i.id === 'gpurchase:11953315030926749523');
    const purchase = items.find((i) => i.id === 'gpurchase:2228975518603505535');
    expect(reservation?.classification).toBe('event');
    expect(purchase?.classification).toBe('purchase');
  });

  it('sets a meaningful Title (not a bare filename)', async () => {
    const items = await run();
    for (const it of items) {
      expect(typeof it.metadata?.Title).toBe('string');
      expect(metaText(it.metadata.Title).length).toBeGreaterThan(0);
      expect(it.metadata.Title).not.toBe(it.content?.filename);
    }

    const reservation = items.find((i) => i.id === 'gpurchase:11953315030926749523');
    expect(reservation?.metadata?.Title).toBe('Dining Reservation — Cucina Enoteca Irvine');
    expect(reservation?.metadata?.Merchant).toBe('Cucina Enoteca Irvine');
    expect(reservation?.metadata?.PartySize).toBe(4);
    expect(reservation?.metadata?.Address).toContain('Irvine');
    const purchase = items.find((i) => i.id === 'gpurchase:2228975518603505535');
    expect(purchase?.metadata?.Title).toBe('Pixel Buds Pro');
    expect(purchase?.metadata?.Total).toBe(199.99);
    expect(purchase?.metadata?.Currency).toBe('USD');
    expect(purchase?.metadata?.Merchant).toBe('Google Store');
  });

  it('gives every item a truthy, distinct id and parseable timestamp', async () => {
    const items = await run();
    const ids = items.map((i) => i.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const it of items) {
      expect(it.timestamp instanceof Date).toBe(true);
      expect(isNaN(it.timestamp!.getTime())).toBe(false);
    }

    const reservation = items.find((i) => i.id === 'gpurchase:11953315030926749523');
    expect(reservation?.timestamp?.toISOString()).toBe('2023-07-02T00:00:00.000Z');
  });

  it('is idempotent across re-import', async () => {
    const a = (await run()).map((i) => i.id!).sort();
    const b = (await run()).map((i) => i.id!).sort();
    expect(b).toEqual(a);
  });
});
