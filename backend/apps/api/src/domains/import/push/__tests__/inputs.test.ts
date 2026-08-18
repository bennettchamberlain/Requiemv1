import { CommunicationType } from '@ci/domains/memory';

import type { StagedItem } from '../../entities/StagedItemEntity';
import { toCanonical, type CanonicalRecord } from '../canonical';
import {
  communicationTypeFor,
  toBrowserActivityInput,
  toCommunicationInput,
  toEventInput,
  toInventoryInput,
  toPositionInput,
} from '../inputs';

/**
 * Where the port actually CHANGED something.
 *
 * The routing rules came across unmodified (see canonical.test.ts); these
 * builders did not, because ci-server's DTOs are not the `/v1` HTTP shapes
 * upstream emitted. Each case below is a place the two disagree, and getting one
 * wrong is silent: the record still lands, with a field empty, mistyped, or —
 * worst — plausibly wrong.
 */

function recordFor(overrides: Partial<StagedItem> = {}): CanonicalRecord {
  return toCanonical({
    id: '11111111-1111-4111-8111-111111111111',
    runId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333',
    dataSource: 'gmail',
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
  } as StagedItem);
}

describe('the provenance triple', () => {
  it('rides snake_case on every destination but inventory', () => {
    const record = recordFor({ classification: 'email' });

    expect(toCommunicationInput(record)).toMatchObject({
      source_type: 'ci-import-tools',
      source_system: 'gmail',
      source_id: 'hash-1',
    });
  });

  it('rides camelCase on inventory, which is the one camelCase ingest DTO', () => {
    const record = recordFor({ classification: 'purchase', metadata: { Product: 'Kettle' } });

    expect(toInventoryInput(record)).toMatchObject({
      sourceType: 'ci-import-tools',
      sourceSystem: 'gmail',
      sourceId: 'hash-1',
    });
  });
});

describe('toCommunicationInput', () => {
  it('passes time as a Date, which the DTO requires', () => {
    // Upstream left this an ISO string for its HTTP sender to normalise.
    expect(toCommunicationInput(recordFor({ classification: 'email' })).time).toBeInstanceOf(Date);
  });

  it('defaults direction to inbound when the source states none', () => {
    // `direction` is required here where upstream left it optional. An archived
    // message that never says the user sent it is far more often one they
    // received, and mislabelling a received message as sent misattributes
    // authorship.
    expect(toCommunicationInput(recordFor({ classification: 'message' })).direction).toBe('inbound');
  });

  it('honours a direction the source does state', () => {
    const outbound = recordFor({ classification: 'message', metadata: { Direction: 'sent' } });

    expect(toCommunicationInput(outbound).direction).toBe('outbound');
  });
});

describe('communicationTypeFor', () => {
  it('maps a kind onto the enum rather than a bare string', () => {
    expect(communicationTypeFor('communication.email')).toBe(CommunicationType.EMAIL);
    expect(communicationTypeFor('communication.call')).toBe(CommunicationType.CALL);
  });

  it('lets one source declare several types under a single kind', () => {
    // A Twitter/X archive holds public POSTS alongside one-to-one DMs, and every
    // one of them is classified 'message'.
    expect(communicationTypeFor('communication.message', { CommunicationType: 'post' })).toBe(
      CommunicationType.POST,
    );
  });

  it('ignores a declared type outside the set a source may claim', () => {
    // Widening this to the whole enum would let a typo in one export's metadata
    // pick `video_call` for every message in it.
    expect(communicationTypeFor('communication.message', { CommunicationType: 'video_call' })).toBe(
      CommunicationType.CHAT,
    );
  });
});

describe('toInventoryInput', () => {
  const purchase = (condition: string) =>
    toInventoryInput(
      recordFor({ classification: 'purchase', metadata: { Product: 'Kettle', Condition: condition } }),
    );

  it('lowercases the condition vocabulary the column actually stores', () => {
    // Upstream returned the GraphQL enum's uppercase spellings and let the
    // transport lowercase them. That transport is gone.
    expect(purchase('Used - Like New').condition).toBe('like_new');
    expect(purchase('New').condition).toBe('new');
    expect(purchase('Used - Very Good').condition).toBe('good');
  });

  it('answers "no grade here" rather than inventing one', () => {
    // A bare "Used" states no grade and the enum has no ungraded-used bucket.
    expect(purchase('Used').condition).toBe('n/a');
    expect(purchase('Not Available').condition).toBe('n/a');
  });

  it('passes acquiredAt as a Date', () => {
    expect(purchase('New').acquiredAt).toBeInstanceOf(Date);
  });
});

describe('toPositionInput', () => {
  it('puts longitude in x and latitude in y, the order PostGIS uses', () => {
    // The reverse of how coordinates are spoken, and invisible if swapped —
    // every fix would simply be somewhere else.
    const fix = toPositionInput(
      recordFor({ classification: 'location', latitude: 37.7936, longitude: -122.3965 }),
    );

    expect(fix?.location).toEqual({ x: -122.3965, y: 37.7936 });
  });

  it('returns null for a record with no fix rather than throwing', () => {
    expect(toPositionInput(recordFor({ classification: 'message' }))).toBeNull();
  });

  it('keeps time as a string, which this DTO takes', () => {
    const fix = toPositionInput(recordFor({ classification: 'location', latitude: 1, longitude: 2 }));

    expect(typeof fix?.time).toBe('string');
  });

  it('refuses a coordinate pair as a place name', () => {
    // google_fit titles a trackpoint with its own coordinates when it has no
    // waypoint name. Stored as `name`, that makes the row look already-named to
    // the reverse-geocode candidate filter ("coordinates present, name
    // missing"), so it is never offered to the geocoder — 62,832 of 62,833
    // positions on a real Takeout, and a Places view holding one entry.
    const fix = toPositionInput(
      recordFor({
        classification: 'location',
        latitude: 33.51469,
        longitude: -117.72169,
        // The shape google_fit emits: `Title` falls back to the fix's own
        // coordinates when the trackpoint has no waypoint name.
        metadata: { Title: '33.51469, -117.72169' },
      }),
    );

    expect(fix?.name).toBeUndefined();
    // The geometry is still stored — only the fake name is dropped.
    expect(fix?.location).toEqual({ x: -117.72169, y: 33.51469 });
  });

  it('keeps a real place name, including one that contains numbers', () => {
    const named = toPositionInput(
      recordFor({
        classification: 'location',
        latitude: 1,
        longitude: 2,
        metadata: { Title: 'Cafe 40.7, 74.0' },
      }),
    );

    expect(named?.name).toBe('Cafe 40.7, 74.0');

    const waypoint = toPositionInput(
      recordFor({ classification: 'location', latitude: 1, longitude: 2, metadata: { Name: 'Summit' } }),
    );

    expect(waypoint?.name).toBe('Summit');
  });
});

describe('toBrowserActivityInput', () => {
  it('keeps time as a string, unlike communications and events', () => {
    const view = recordFor({ classification: 'page_view', metadata: { URL: 'https://example.com' } });

    expect(typeof toBrowserActivityInput(view).time).toBe('string');
  });

  it('falls back to the query when a search carries no page URL', () => {
    const search = recordFor({ classification: 'search', metadata: { Query: 'kettle descaling' } });

    expect(toBrowserActivityInput(search).url).toBeTruthy();
  });
});

describe('toEventInput', () => {
  it('names an untitled record by its kind rather than leaving the title blank', () => {
    // `title` is required here where upstream left it optional.
    const untitled = recordFor({ classification: 'photo', mediaType: 'image/jpeg' });

    expect(toEventInput(untitled).title).toBe('capture.photo');
  });

  it('carries the GPS provenance in metadata as well as on the position row', () => {
    // LocationEstimateService weighs donors by accuracy; an event whose position
    // leg was skipped would otherwise carry a coordinate with no idea how good
    // it is.
    const geotagged = recordFor({
      classification: 'photo',
      mediaType: 'image/jpeg',
      latitude: 1,
      longitude: 2,
    });
    const input = toEventInput(geotagged);

    expect(input.metadata?.locationSource).toBe('exif');
    expect(input.metadata?.accuracyMeters).toBe(30);
  });

  it('passes start_time as a Date and the coordinate as a GeoJSON Point', () => {
    const visit = recordFor({ classification: 'place', latitude: 37.7936, longitude: -122.3965 });
    const input = toEventInput(visit);

    expect(input.start_time).toBeInstanceOf(Date);
    expect(input.location_coordinates).toEqual({ type: 'Point', coordinates: [-122.3965, 37.7936] });
  });
});
