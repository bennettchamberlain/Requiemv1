import fs from 'node:fs';
import os from 'node:os';
import path from 'path';

import { StravaFileImporter } from '../strava';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');

describe('Strava datasource', () => {
  it('recognizes directory with activities.csv and activities/ folder', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const fi = new StravaFileImporter();
    const rec = await fi.recognize({}, { filename: 'strava-export', fullPath: root });
    expect(rec.confidence).toBeGreaterThan(0.9);
  });

  it('recognizes activities.csv directly', async () => {
    const fpath = path.join(FIXTURES_DIR, 'strava-export', 'activities.csv');
    const fi = new StravaFileImporter();
    const rec = await fi.recognize({}, { filename: 'activities.csv', fullPath: fpath });
    expect(rec.confidence).toBeGreaterThan(0.8);
  });

  it('imports workout items from activities.csv', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const fi = new StravaFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'strava-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const workouts = pipeline.filter((p) => p.item.classification === 'workout');
    expect(workouts.length).toBe(2); // 2 CSV rows
  });

  it('imports GPX track points for activities with .gpx files', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const fi = new StravaFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'strava-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const locationItems = pipeline.filter((p) => p.item.classification === 'location');
    expect(locationItems.length).toBeGreaterThan(0); // GPX track points from morning_run.gpx
    expect(locationItems[0].item.location?.latitude).toBeDefined();
    expect(locationItems[0].item.location?.longitude).toBeDefined();
  });

  it('parses workout metadata from CSV', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const fi = new StravaFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'strava-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const workout = pipeline.find(
      (p) => p.item.classification === 'workout' && p.item.metadata?.Name === 'Morning Run',
    );
    expect(workout).toBeDefined();
    expect(workout!.item.metadata['Activity Type']).toBe('Run');
    expect(workout!.item.metadata['Elapsed Time (s)']).toBe(1823);
    expect(workout!.item.metadata.Source).toBe('Strava');
  });

  // Regression: activities.csv's "Evening Ride" row points at a .gpx.gz file.
  // Both the coordinate-peek (firstCoordFromActivity) and the full-import
  // gunzip path (processGpxFile) check fs.existsSync first, so if the .gz
  // fixture were ever missing again the entire decompression branch would
  // silently stop running — no test would fail, it would just import zero
  // trackpoints for every .gz activity in a real export.
  it('decompresses a .gpx.gz activity file and imports its trackpoints', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const fi = new StravaFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'strava-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const rideWorkout = pipeline.find(
      (p) => p.item.classification === 'workout' && p.item.metadata?.Name === 'Evening Ride',
    );
    expect(rideWorkout).toBeDefined();
    // The workout summary gets its map pin from firstCoordFromActivity, which
    // must have gunzipped the file to read the first <trkpt lat=.. lon=..>.
    expect(rideWorkout!.item.location).toEqual({ latitude: 37.8044, longitude: -122.2712 });

    // processGpxFile decompresses to a temp file and hands it to GPXFileImporter,
    // which emits one 'location' item per trackpoint in the decompressed GPX.
    const rideTrackpoints = pipeline.filter(
      (p) => p.item.classification === 'location' && p.item.location?.latitude === 37.8067,
    );
    expect(rideTrackpoints.length).toBeGreaterThan(0);
  });

  it('cleans up its temp file after decompressing a .gpx.gz activity', async () => {
    const root = path.join(FIXTURES_DIR, 'strava-export');
    const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ci-strava-'));
    const fi = new StravaFileImporter();
    const pipeline: EmittedGraph[] = [];
    await fi.fileImport({}, { filename: 'strava-export', fullPath: root }, {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams);

    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ci-strava-'));
    expect(after).toEqual(before);
  });

  it('falls back to Activity Type for the title when Activity Name is empty', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-strava-test-'));
    fs.writeFileSync(
      path.join(dir, 'activities.csv'),
      'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Filename\n' +
        '555,"Jan 3, 2021, 9:00:00 AM",,Hike,2400,3.2,\n',
    );
    try {
      const fi = new StravaFileImporter();
      const pipeline: EmittedGraph[] = [];
      await fi.fileImport({}, { filename: 'strava-export', fullPath: dir }, {
        pipeline,
        timeframe: {},
        log: () => {},
      } as unknown as ImportParams);

      const workout = pipeline.find((p) => p.item.classification === 'workout');
      expect(workout).toBeDefined();
      // titleFor reads metadata.Name; with no Activity Name it must fall back to
      // the Activity Type rather than the bare 'activity.txt' filename.
      expect(workout!.item.metadata.Name).toBe('Hike');
      expect(workout!.item.content.filename).toBe('activity.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
