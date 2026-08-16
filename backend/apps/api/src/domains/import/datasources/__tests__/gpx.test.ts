import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GPXFileImporter } from '../gpx';
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

describe('GPX title fallback', () => {
  it('titles trackpoints from the track name instead of the bare filename', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-title-'));
    const gpxPath = path.join(tmp, 'morning_run.gpx');
    const gpxContent = `<?xml version="1.0"?><gpx><trk><name>Morning Run</name><trkseg><trkpt lat="12.34" lon="56.78"><time>2024-01-02T03:04:05Z</time></trkpt></trkseg></trk></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    const item = collected[0].item;
    // Name is a title-bearing key honored by titleFor, so the trackpoint no
    // longer falls back to the bare 'morning_run.gpx' filename.
    expect(item.metadata.Name).toBe('Morning Run');
    expect(item.metadata.Name).not.toBe(path.basename(gpxPath));
  });
});

describe('GPX HDOP/VDOP extraction', () => {
  it('lifts <hdop>/<vdop> off track points into metadata for the position pipeline', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-hdop-'));
    const gpxPath = path.join(tmp, 'with_dop.gpx');
    // A typical Garmin-style trackpoint carries lat/lon/ele/time + hdop/vdop.
    // Without these the canonical mapper has no accuracy signal and falls back
    // to a default — extracting them surfaces a real ~5m/unit accuracy estimate.
    const gpxContent = `<?xml version="1.0"?><gpx><trk><trkseg><trkpt lat="12.34" lon="56.78"><time>2024-01-02T03:04:05Z</time><ele>120.5</ele><hdop>2.5</hdop><vdop>3.1</vdop></trkpt></trkseg></trk></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    const item = collected[0].item;
    expect(item.metadata.HDOP).toBe(2.5);
    expect(item.metadata.VDOP).toBe(3.1);
    expect(item.metadata.Elevation).toBe(120.5);
  });

  it('declines .gpx files inside a Strava export so strava.ts wins recognition', async () => {
    // Regression: recognition keeps the best confidence per data source across
    // the tree, so a bare 1.0 on activities/*.gpx beat strava's 0.95 and the
    // whole export imported as plain GPX, silently dropping activities.csv.
    const root = path.join(__dirname, 'fixtures', 'strava-export');
    const fileImporter = new GPXFileImporter();
    const rec = await fileImporter.recognize(undefined, {
      fullPath: path.join(root, 'activities', 'morning_run.gpx'),
    } as DirEntry);
    expect(rec.confidence).toBe(0);
  });

  it('still claims a standalone .gpx with no Strava archive above it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-standalone-'));
    const gpxPath = path.join(tmp, 'walk.gpx');
    fs.writeFileSync(gpxPath, '<?xml version="1.0"?><gpx></gpx>', 'utf8');
    const fileImporter = new GPXFileImporter();
    const rec = await fileImporter.recognize(undefined, { fullPath: gpxPath } as DirEntry);
    expect(rec.confidence).toBe(1.0);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('lifts <hdop>/<vdop> off waypoints too (same field names, separate code path)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-wpt-hdop-'));
    const gpxPath = path.join(tmp, 'wpt_dop.gpx');
    const gpxContent = `<?xml version="1.0"?><gpx><wpt lat="12.34" lon="56.78"><name>Summit</name><time>2024-01-02T03:04:05Z</time><hdop>4</hdop></wpt></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    expect(collected[0].item.metadata.HDOP).toBe(4);
  });
});
