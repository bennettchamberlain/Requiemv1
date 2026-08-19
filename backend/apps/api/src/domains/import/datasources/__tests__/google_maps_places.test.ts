import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'path';

import { GoogleMapsPlacesFileImporter } from '../google_maps_places';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const DIR = path.join(__dirname, 'fixtures', 'google-maps-places', 'Maps (your places)');

function runDir(): Promise<EmittedGraph[]> {
  const fi = new GoogleMapsPlacesFileImporter();
  const pipeline: EmittedGraph[] = [];

  return fi
    .fileImport({}, { filename: 'Maps (your places)', fullPath: DIR }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams)
    .then(() => pipeline.filter((p) => p.item));
}

describe('Google Maps (your places) datasource', () => {
  it('recognizes the "Maps (your places)" directory', async () => {
    const fi = new GoogleMapsPlacesFileImporter();
    const rec = await fi.recognize({}, { filename: 'Maps (your places)', fullPath: DIR });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes a Saved Places.json file', async () => {
    const fi = new GoogleMapsPlacesFileImporter();
    const rec = await fi.recognize(
      {},
      {
        filename: 'Saved Places.json',
        fullPath: path.join(DIR, 'Saved Places.json'),
      },
    );
    expect(rec.confidence).toBeGreaterThan(0);
  });

  it('imports saved places and reviews', async () => {
    const items = (await runDir()).map((p) => p.item);
    expect(items.length).toBe(3);

    const places = items.filter((i) => i.classification === 'place');
    const reviews = items.filter((i) => i.classification === 'annotation');
    expect(places.length).toBe(2);
    expect(reviews.length).toBe(1);
  });

  it('maps a saved place with coordinates, title, address, and cid-based id', async () => {
    const items = (await runDir()).map((p) => p.item);
    const place = items.find((i) => i.metadata?.Name === 'St Germaine Apartments');
    expect(place).toBeDefined();
    expect(place!.classification).toBe('place');
    expect(place!.location?.latitude).toBeCloseTo(34.0556813, 5);
    expect(place!.location?.longitude).toBeCloseTo(-118.3062426, 5);
    expect(place!.metadata?.Title).toBe('St Germaine Apartments');
    expect(place!.metadata?.Address).toContain('900 S Serrano Ave');
    expect(place!.id).toBe('gmaps:place:2552432144292227829');
    expect(place!.timestamp?.toISOString()).toBe('2023-09-30T17:32:23.000Z');
  });

  it('treats the [0,0] placeholder coordinate as no location', async () => {
    const items = (await runDir()).map((p) => p.item);
    const noLoc = items.find((i) => i.metadata?.Comment);
    expect(noLoc).toBeDefined();
    expect(noLoc!.location).toBeUndefined();
    // Title falls back to the address, never the bare filename.
    expect(noLoc!.metadata?.Title).toContain('213 S 12th St');
  });

  it('maps a review with rating, text, place title, and index-based id', async () => {
    const items = (await runDir()).map((p) => p.item);
    const review = items.find((i) => i.classification === 'annotation');
    expect(review!.metadata?.Title).toBe('Laguna Niguel Smiles Dentistry');
    expect(review!.metadata?.Rating).toBe(5);
    expect(review!.metadata?.Text).toBe('Great staff and reasonably priced.');
    expect(review!.id).toBe('gmaps:review:0');
    expect(review!.location?.latitude).toBeCloseTo(33.5256569, 5);
    expect(review!.timestamp?.toISOString()).toBe('2025-01-20T21:49:34.812Z');
  });

  it('gives every item a truthy, distinct id and a parseable timestamp', async () => {
    const items = (await runDir()).map((p) => p.item);
    const ids = items.map((i) => i.id!);
    expect(ids.every((id) => !!id)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of items) {
      expect(i.timestamp).toBeInstanceOf(Date);
      expect(isNaN(i.timestamp!.getTime())).toBe(false);
    }
  });

  it('produces the same ids on re-import (idempotent)', async () => {
    const a = (await runDir()).map((p) => p.item.id!).sort();
    const b = (await runDir()).map((p) => p.item.id!).sort();
    expect(b).toEqual(a);
  });

  it('recurses into the current Takeout My labeled places layout', async () => {
    const root = await fs.promises.mkdtemp(path.join(tmpdir(), 'google-maps-current-'));
    const nested = path.join(root, 'My labeled places');
    await fs.promises.mkdir(nested, { recursive: true });
    await fs.promises.writeFile(
      path.join(nested, 'Labeled places.json'),
      JSON.stringify({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [-118.5, 34.2] },
            properties: { name: 'Home', address: 'Example address' },
          },
        ],
      }),
    );

    const importer = new GoogleMapsPlacesFileImporter();
    const rec = await importer.recognize({}, { filename: root, fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0);
    const pipeline: EmittedGraph[] = [];
    await importer.fileImport({}, { filename: root, fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].item.metadata).toMatchObject({
      Title: 'Home',
      Address: 'Example address',
      Kind: 'labeled_place',
    });
    expect(pipeline[0].item.location).toEqual({ latitude: 34.2, longitude: -118.5 });
    expect(pipeline[0].item.id).toMatch(/^gmaps:place:[0-9a-f]{40}$/);
  });
});
