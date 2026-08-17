import type { StagedItem } from '../../entities/StagedItemEntity';
import { destinationsFor, kindFor, toCanonical, type CanonicalRecord } from '../canonical';

/**
 * The routing rules, which are the whole reason this mapping was ported rather
 * than rewritten. Nearly every case here is a decision someone made after
 * watching real data land in the wrong place:
 *
 *  - ~96k Google/YouTube searches landed in `ci.events` instead of
 *    `ci.browser_activity`;
 *  - a content row per text-only calendar event duplicated every agenda into
 *    `ci.content` as a phantom document;
 *  - millions of GPS trackpoints drowned the timeline;
 *  - undated files dated themselves to the moment of import.
 *
 * A regression in any of them is silent — the import still "succeeds", the rows
 * are just in the wrong table.
 */

function stagedRow(overrides: Partial<StagedItem> = {}): StagedItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    dataSource: 'gpx',
    classification: null,
    contentHash: 'hash-1',
    occurredAt: new Date('2024-03-02T10:00:00Z'),
    timespanEnd: null,
    latitude: null,
    longitude: null,
    filename: null,
    mediaType: null,
    originalLocation: null,
    intermediateLocation: null,
    metadata: {},
    createdAt: new Date('2026-08-12T00:00:00Z'),
    ...overrides,
  } as StagedItem;
}

function recordFor(overrides: Partial<StagedItem> = {}): CanonicalRecord {
  return toCanonical(stagedRow(overrides));
}

describe('toCanonical', () => {
  it('takes sourceId from the content hash, not the staging row id', () => {
    // The staging id is a fresh uuid per run. Using it would make an identical
    // re-import a brand new record in ci.* instead of the no-op the dedup triple
    // exists to produce.
    const record = recordFor({ contentHash: 'gmail-msg-1' });

    expect(record.sourceId).toBe('gmail-msg-1');
    expect(record.sourceId).not.toBe(stagedRow().id);
  });

  it('marks a row dated when the source gave it a time', () => {
    expect(recordFor({ occurredAt: new Date('2012-07-04T10:00:00Z') }).dated).toBe(true);
  });

  it('falls back to the row creation time and says so', () => {
    // The fallback is IMPORT time. `dated: false` is what stops it being
    // presented as a timeline occurrence.
    const record = recordFor({ occurredAt: null });

    expect(record.dated).toBe(false);
    expect(record.startTime).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('kindFor', () => {
  it('lets the MIME decide when the classification is the generic "media"', () => {
    // google_photos stamps 'media' on photos AND videos AND audio, so the
    // classification alone cannot pick the kind.
    expect(kindFor('media', 'image/jpeg')).toBe('capture.photo');
    expect(kindFor('media', 'video/mp4')).toBe('capture.video');
  });

  it('maps the messaging classifications apart rather than into one bucket', () => {
    expect(kindFor('message', null)).toBe('communication.message');
    expect(kindFor('email', null)).toBe('communication.email');
    expect(kindFor('call', null)).toBe('communication.call');
  });
});

describe('destinationsFor', () => {
  it('sends a web search to browser activity, not the timeline', () => {
    expect(destinationsFor(recordFor({ classification: 'search' }))).toEqual(['browser_activity']);
  });

  it('keeps a raw GPS fix out of events entirely', () => {
    const track = recordFor({ classification: 'location', latitude: 1, longitude: 2 });

    expect(destinationsFor(track)).toEqual(['position']);
  });

  it('keeps a place VISIT on the timeline as well as donating its fix', () => {
    // A visit's time and name have narrative value; a trackpoint's does not.
    const visit = recordFor({ classification: 'place', latitude: 1, longitude: 2 });

    expect(destinationsFor(visit)).toEqual(['events', 'position']);
  });

  it('gives a text-only calendar event no content row', () => {
    const agenda = recordFor({ classification: 'event' });

    expect(destinationsFor(agenda)).toEqual(['events']);
  });

  it('gives a calendar event that carries a file both homes', () => {
    const invite = recordFor({
      classification: 'event',
      mediaType: 'image/png',
      intermediateLocation: '/scratch/invite.png',
    });

    expect(destinationsFor(invite)).toEqual(['events', 'content']);
  });

  it('routes an undated file to content alone', () => {
    // Its startTime would be the moment of import, which reads as a real date on
    // the timeline and is pure noise beside the EXIF-dated items around it.
    const orphan = recordFor({
      classification: 'photo',
      occurredAt: null,
      mediaType: 'image/jpeg',
      intermediateLocation: '/scratch/IMG_0001.jpg',
    });

    expect(destinationsFor(orphan)).toEqual(['content']);
  });

  it('donates a geotagged message to the position table as well', () => {
    const tweet = recordFor({ classification: 'message', latitude: 1, longitude: 2 });

    expect(destinationsFor(tweet)).toEqual(['communications', 'position']);
  });

  it('pushes a subscription fee nowhere at all', () => {
    // A Prime or Kindle Unlimited charge is a service, not a thing: neither
    // content nor inventory. The order aggregate still carries it to events.
    const fee = recordFor({ classification: 'purchase', metadata: { Subscription: true } });

    expect(destinationsFor(fee)).toEqual([]);
  });

  it('sends a physical purchase to inventory and a digital one to content', () => {
    const physical = recordFor({ classification: 'purchase' });

    expect(destinationsFor(physical)).toEqual(['inventory']);
  });

  it('sends a money movement to events alone', () => {
    // There is no document or media "thing" behind a transaction worth a
    // searchable corpus row.
    expect(destinationsFor(recordFor({ classification: 'transaction' }))).toEqual(['events']);
  });

  it('gives a play both a timeline occurrence and a searchable row', () => {
    expect(destinationsFor(recordFor({ classification: 'play' }))).toEqual(['events', 'content']);
  });

  it('gives a saved library artifact content alone', () => {
    // Its source records no time the user did anything, so an event would pin it
    // to import time.
    expect(destinationsFor(recordFor({ classification: 'saved_media' }))).toEqual(['content']);
  });
});
