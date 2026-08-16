import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GPXFileImporter } from '../gpx';
import { KMLGXFileImporter } from '../kmlgx';
import type { DirEntry } from '../registry';
import type { ImportParams, Graph } from '../timeline';

import type { EmittedGraph } from './support/emitted';

// minimal mock pipeline
function makeParams(): { params: ImportParams; collected: EmittedGraph[] } {
  const collected: EmittedGraph[] = [];
  const params: ImportParams = {
    pipeline: { push: (g: Graph) => collected.push(g as EmittedGraph) },
    timeframe: undefined,
  };

  return { params, collected };
}

describe('GPX & KMLGX datasources', () => {
  it('recognizes and imports a simple GPX file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-'));
    const gpxPath = path.join(tmp, 'track.gpx');
    const gpxContent = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="12.34" lon="56.78"><time>2024-01-02T03:04:05Z</time><ele>10.5</ele></trkpt></trkseg></trk></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const rec = await fileImporter.recognize(undefined, { fullPath: gpxPath } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    const item = collected[0].item;
    expect(item.location!.latitude).toBeCloseTo(12.34);
    expect(item.metadata.Source).toBe('GPX');
  });

  it('recognizes and imports a simple KML file with gx:Track', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-kml-'));
    const kmlPath = path.join(tmp, 'track.kml');
    const kmlContent = `<?xml version="1.0"?><kml gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><Track><when>2024-01-02T03:04:05Z</when><coord>56.78 12.34 15.0</coord></Track></Placemark></Document></kml>`;
    fs.writeFileSync(kmlPath, kmlContent, 'utf8');
    const fileImporter = new KMLGXFileImporter();
    const rec = await fileImporter.recognize(undefined, { fullPath: kmlPath } as DirEntry);
    expect(rec.confidence).toBeGreaterThan(0.5);
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: kmlPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    const item = collected[0].item;
    expect(item.location!.longitude).toBeCloseTo(56.78);
    expect(item.metadata.Source).toBe('KMLGX');
    expect(item.metadata.Altitude).toBe(15.0);
    // title-bearing key so titleFor doesn't fall back to the bare 'track.kml' filename
    expect(item.metadata.Name).toBe('Location 12.34000,56.78000');
    expect(item.metadata.Name).not.toBe(item.content.filename);
  });
});
