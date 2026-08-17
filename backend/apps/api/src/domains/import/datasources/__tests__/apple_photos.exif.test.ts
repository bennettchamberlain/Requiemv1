import fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Mock exifr so the EXIF read is deterministic regardless of fixture bytes.
jest.mock('exifr', () => ({ __esModule: true, default: { parse: jest.fn() } }));
import exifr from 'exifr';

import { allDataSources } from '../registry';
import type { DirEntry } from '../registry';
import type { ImportParams } from '../timeline';

import type { EmittedGraph } from './support/emitted';

import '../apple_photos';

const parseMock = exifr.parse as unknown as jest.MockedFunction<(...args: unknown[]) => Promise<unknown>>;

function getImporter() {
  const ds = allDataSources().find((d) => d.name === 'apple_photos');
  if (!ds?.newFileImporter) {
    throw new Error('missing importer');
  }

  return ds.newFileImporter();
}

/** A minimal *.photoslibrary with one media file under originals/<bucket>/. */
async function libraryWithOneMedia(name = 'IMG_0001.heic'): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(tmpdir(), 'ap-exif-'));
  const bucket = path.join(dir, 'originals', '0A');
  await fs.promises.mkdir(bucket, { recursive: true });
  await fs.promises.writeFile(path.join(bucket, name), 'not-a-real-image');

  return dir;
}

async function runImport(dir: string) {
  const pipeline: EmittedGraph[] = [];
  await getImporter().fileImport(
    {},
    { filename: dir, fullPath: dir } as DirEntry,
    {
      pipeline,
      timeframe: {},
      log: () => {},
    } as unknown as ImportParams,
  );

  return pipeline.map((g) => g.item);
}

describe('apple_photos EXIF GPS + timestamp', () => {
  beforeEach(() => parseMock.mockReset());

  it('records GPS coordinates and a host-TZ-independent capture time', async () => {
    // exifr revives the timezone-less EXIF wall-clock with LOCAL Date
    // constructors; mimic that here (May 1 2021, 12:00 wall-clock).
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2021, 4, 1, 12, 0, 0),
      latitude: 34.0441,
      longitude: -118.2598,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.location).toEqual({ latitude: 34.0441, longitude: -118.2598 });
    // The wall-clock is re-interpreted as UTC -> same absolute instant on every
    // host, regardless of the runner's timezone.
    expect(item.timestamp!.toISOString()).toBe('2021-05-01T12:00:00.000Z');
    expect(item.metadata['Timestamp Source']).toBe('EXIF');
  });

  it('applies OffsetTimeOriginal when the camera recorded its zone (true instant, not floating)', async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2021, 4, 1, 12, 0, 0),
      OffsetTimeOriginal: '+02:00',
    });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.timestamp!.toISOString()).toBe('2021-05-01T10:00:00.000Z');
    expect(item.metadata['Timestamp Source']).toBe('EXIF');
  });

  it('rejects a null-island (0,0) sentinel and keeps no location', async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date('2021-05-01T12:00:00.000Z'),
      latitude: 0,
      longitude: 0,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.location).toBeUndefined();
  });

  it('falls back to file mtime (no location) when the file has no EXIF', async () => {
    // exifr.parse resolves to undefined for a file with no readable metadata.
    parseMock.mockResolvedValue(undefined);
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.location).toBeUndefined();
    // Realm-safe: the mtime fallback yields a Date from the Node builtin,
    // outside Jest's sandbox realm, so toBeInstanceOf(Date) would compare
    // against a different constructor. See apple_photos.test.ts.
    expect(Object.prototype.toString.call(item.timestamp)).toBe('[object Date]');
    expect(Number.isNaN(item.timestamp!.getTime())).toBe(false);
    expect(item.metadata['Timestamp Source']).toBe('File mtime');
  });

  it('keeps GPS even when EXIF carries no capture time (date falls back to mtime)', async () => {
    parseMock.mockResolvedValue({ latitude: 40.7128, longitude: -74.006 });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.location).toEqual({ latitude: 40.7128, longitude: -74.006 });
    expect(item.metadata['Timestamp Source']).toBe('File mtime');
  });

  it('lifts EXIF GPSHPositioningError into AccuracyMeters when the camera recorded one', async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2021, 4, 1, 12, 0, 0),
      latitude: 34.0441,
      longitude: -118.2598,
      GPSHPositioningError: 8.5,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    // Surfaced under AccuracyMeters so the canonical mapper publishes a real
    // accuracy_meters for the position pipeline (beats the 30m EXIF default).
    expect(item.metadata.AccuracyMeters).toBe(8.5);
  });

  it('treats GPSHPositioningError <= 0 as "unknown" and leaves AccuracyMeters absent', async () => {
    // Some cameras write 0 when they don't have an estimate — guard against
    // recording that as a literal zero-meter fix.
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2021, 4, 1, 12, 0, 0),
      latitude: 34.0441,
      longitude: -118.2598,
      GPSHPositioningError: 0,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.metadata.AccuracyMeters).toBeUndefined();
  });

  it('does not surface AccuracyMeters when GPS itself is absent', async () => {
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2021, 4, 1, 12, 0, 0),
      GPSHPositioningError: 12,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    expect(item.location).toBeUndefined();
    expect(item.metadata.AccuracyMeters).toBeUndefined();
  });

  it('carries EXIF camera/lens/exposure fields onto the emitted item.metadata', async () => {
    // Without this branch every iPhone/Sony/Canon shot landed with no body+lens
    // info, blocking camera-aware search ("photos shot on the X100V") and the
    // gallery-drawer's Camera/Lens/Exposure rows.
    parseMock.mockResolvedValue({
      DateTimeOriginal: new Date(2024, 5, 15, 10, 30, 0),
      latitude: 37.7749,
      longitude: -122.4194,
      Make: 'Apple',
      Model: 'iPhone 15 Pro',
      LensModel: 'iPhone 15 Pro back triple camera 6.86mm f/1.78',
      FNumber: 1.78,
      ExposureTime: 0.025,
      ISO: 100,
      FocalLength: 6.86,
      Orientation: 6,
    });
    const [item] = await runImport(await libraryWithOneMedia());
    // Existing core fields untouched.
    expect(item.metadata.Source).toBe('Apple Photos');
    expect(item.metadata['Timestamp Source']).toBe('EXIF');
    // Camera bag — merged in via the shared extractCameraFields helper.
    expect(item.metadata.Make).toBe('Apple');
    expect(item.metadata.Model).toBe('iPhone 15 Pro');
    expect(item.metadata.Lens).toBe('iPhone 15 Pro back triple camera 6.86mm f/1.78');
    expect(item.metadata['F-Number']).toBe(1.78);
    expect(item.metadata['Exposure Time']).toBe(0.025);
    expect(item.metadata.ISO).toBe(100);
    expect(item.metadata['Focal Length']).toBe(6.86);
    expect(item.metadata.Orientation).toBe(6);
  });

  it('captures QuickTime video metadata (Duration / Frame Rate / Width / Height / Codec) for .mov files', async () => {
    // Without this branch every .mov landed with only filename + mtime — no
    // duration, no codec, no Live-Photo recognition possible. Mock exifr to
    // return what it pulls from an iPhone .mov's moov atom.
    parseMock.mockResolvedValue({
      CreationDate: new Date(2024, 2, 1, 9, 0, 0),
      Duration: 12.5,
      VideoFrameRate: 29.97,
      ImageWidth: 1920,
      ImageHeight: 1080,
      CompressorID: 'hvc1',
    });
    const [item] = await runImport(await libraryWithOneMedia('IMG_0001.mov'));
    // Video bag landed on metadata.
    expect(item.metadata.Duration).toBe(12.5);
    expect(item.metadata['Frame Rate']).toBe(29.97);
    expect(item.metadata.Width).toBe(1920);
    expect(item.metadata.Height).toBe(1080);
    expect(item.metadata.Codec).toBe('hvc1');
    // The image bag's Title/Bucket/Source still wins over the spread (no
    // accidental Title='hvc1' from a malformed video tag).
    expect(item.metadata.Title).toBe('IMG_0001.mov');
    expect(item.metadata.Source).toBe('Apple Photos');
    // Video timestamps are tagged 'Container' (ffprobe primary, exifr-QuickTime
    // fallback). 'EXIF' is reserved for image TIFF/EXIF tags.
    expect(item.metadata['Timestamp Source']).toBe('Container');
  });

  it('does not run the video extraction for image files', async () => {
    // The video extractor would otherwise dirty an image's metadata bag with
    // empty Width/Height keys from a non-existent QuickTime atom. Image input
    // -> no video keys on the output (extractVideoFields returns {}).
    parseMock.mockResolvedValue({ DateTimeOriginal: new Date(2024, 5, 1, 12, 0, 0) });
    const [item] = await runImport(await libraryWithOneMedia('IMG_0002.heic'));
    expect(item.metadata.Duration).toBeUndefined();
    expect(item.metadata['Frame Rate']).toBeUndefined();
    expect(item.metadata.Codec).toBeUndefined();
  });
});
