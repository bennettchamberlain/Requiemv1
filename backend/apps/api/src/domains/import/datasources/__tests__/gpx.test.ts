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

describe('GPX track name', () => {
  it('does not stamp the track name onto a trackpoint as its place name', async () => {
    // This test used to assert the opposite (`metadata.Name === 'Morning Run'`),
    // which is where the defect lived. `Name` is the key `toPositionInput` reads
    // as a fix's PLACE NAME, and a track name describes the TRACK: a 10 km run
    // with <name>Morning Run</name> gives ~1,000 trackpoints the identical
    // "place", `promote.place_position` resolves the route into ~90 distinct
    // 0.001-degree cells, and up to 90 Location entities all called "Morning
    // Run" land in the Places list — one venue per 100 m of pavement.
    //
    // The name is not discarded: it rides as `Track Name`, which no place-name
    // path reads. The fix keeps its coordinates and no name, which is exactly
    // what makes it a reverse-geocode candidate.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-title-'));
    const gpxPath = path.join(tmp, 'morning_run.gpx');
    const gpxContent = `<?xml version="1.0"?><gpx><trk><name>Morning Run</name><trkseg><trkpt lat="12.34" lon="56.78"><time>2024-01-02T03:04:05Z</time></trkpt></trkseg></trk></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    const item = collected[0].item;
    expect(item.metadata.Name).toBeUndefined();
    expect(item.metadata['Track Name']).toBe('Morning Run');
  });

  it('still reads a WAYPOINT name as a place name — <wpt><name> names a point', async () => {
    // The other side of the same rule: the arm above must not cost a genuine
    // waypoint its name. `<trk><name>` labels a line, `<wpt><name>` labels a
    // point, and only the second is a place.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gpx-wpt-name-'));
    const gpxPath = path.join(tmp, 'summit.gpx');
    const gpxContent = `<?xml version="1.0"?><gpx><wpt lat="12.34" lon="56.78"><name>Summit</name><time>2024-01-02T03:04:05Z</time></wpt></gpx>`;
    fs.writeFileSync(gpxPath, gpxContent, 'utf8');
    const fileImporter = new GPXFileImporter();
    const { params, collected } = makeParams();
    await fileImporter.fileImport(undefined, { fullPath: gpxPath } as DirEntry, params);
    expect(collected.length).toBe(1);
    expect(collected[0].item.metadata.Name).toBe('Summit');
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
