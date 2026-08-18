import { CommunicationType } from '@ci/domains/memory';

import type { StagedItem } from '../../entities/StagedItemEntity';
import { toCanonical, type CanonicalRecord } from '../canonical';
import {
  communicationTypeFor,
  discordAttachmentContentInputs,
  toBrowserActivityInput,
  toCommunicationInput,
  toContentInput,
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

describe('toContentInput', () => {
  it('takes the content bucket from contentTypeFor, not the kind string directly', () => {
    // classification 'play' -> kind 'media.play' -> bucket 'media'.
    const play = recordFor({ classification: 'play', dataSource: 'spotify' });

    expect(toContentInput(play).type).toBe('media');
  });

  it('replaces the per-item sourceId with a source URI, so every play of one track dedups to one row', () => {
    // The exact bug in the file's own comment: without this, keying content on
    // the per-play item id produced 7,339 rows for an archive that should have
    // produced 2,354 — one per track/episode, not one per play.
    const play = recordFor({
      classification: 'play',
      dataSource: 'spotify',
      contentHash: 'play-event-1',
      metadata: { URI: 'spotify:track:123', Track: 'Song Name' },
    });

    const input = toContentInput(play);

    expect(input.external_id).toBe('spotify:track:123');
    expect(input.source_id).toBe('spotify:track:123');
    expect(input.source_id).not.toBe('play-event-1');
  });

  it('keeps the per-item sourceId when the record carries no URI', () => {
    const purchase = recordFor({ classification: 'purchase', contentHash: 'order-line-9' });

    expect(toContentInput(purchase).source_id).toBe('order-line-9');
  });

  it('points external_id at the uploaded file when the record reached content with no URI', () => {
    // An undated photo, or any drive-walk document with no source URI — the
    // upload leg (withContentMedia) stamps FileId just before the send.
    const orphanPhoto = recordFor({
      classification: 'photo',
      occurredAt: null,
      mediaType: 'image/jpeg',
      metadata: { FileId: 'file-uuid-1', FileUrl: 'https://files.example/file-uuid-1' },
    });

    const input = toContentInput(orphanPhoto);

    expect(input.external_id).toBe('file-uuid-1');
    expect(input.url).toBe('https://files.example/file-uuid-1');
    expect(input.mimetype).toBe('image/jpeg');
  });

  it('lets the file id win over a source URI when a record somehow carries both', () => {
    // "The file id wins over a source URI: it identifies these bytes in
    // CI-Server, which is what a consumer of this row needs." — the URI still
    // wins on source_id (the dedup key stays keyed on the track), only
    // external_id (what a consumer follows to the bytes) is overridden.
    const play = recordFor({
      classification: 'play',
      dataSource: 'spotify',
      metadata: { URI: 'spotify:track:123', FileId: 'file-uuid-2' },
    });

    const input = toContentInput(play);

    expect(input.external_id).toBe('file-uuid-2');
    expect(input.source_id).toBe('spotify:track:123');
  });

  it('does not let a stored file’s url clobber a url the source already gave', () => {
    const bookmark = recordFor({
      classification: 'saved_media',
      metadata: { URL: 'https://example.com/article', FileUrl: 'https://files.example/should-not-win' },
    });

    expect(toContentInput(bookmark).url).toBe('https://example.com/article');
  });
});

describe('toContentInput — Reddit media', () => {
  // Reddit posts/comments reach the content lane ONLY for their media (see
  // canonical.test.ts's destinationsFor coverage); this is the row's shape.

  it('gives a link post’s image the post’s own title as both title and text', () => {
    // A link post carries no self-text (Body), so `postText` (rec.description
    // || rec.title) falls back to the post's own title — which is why the
    // row's title and text end up identical here. A self-post's Body would
    // take priority over the title instead (see the next test).
    const post = recordFor({
      classification: 'social',
      dataSource: 'reddit',
      metadata: {
        Title: 'Check out this sunset',
        URL: 'https://i.redd.it/abc123.jpg',
        Subreddit: 'pics',
        Kind: 'post',
      },
    });

    const input = toContentInput(post);

    expect(input.type).toBe('image');
    expect(input.url).toBe('https://i.redd.it/abc123.jpg');
    expect(input.title).toBe('Check out this sunset');
    expect(input.text).toBe('Check out this sunset');
    expect(input.mimetype).toBe('image/jpeg');
    expect(input.source_system).toBe('reddit');
  });

  it('gives a comment’s inline media text but no title — the body already carries it', () => {
    const comment = recordFor({
      classification: 'social',
      dataSource: 'reddit',
      metadata: {
        Body: 'Same spot, here is mine: https://i.redd.it/xyz789.png',
        Subreddit: 'pics',
        Kind: 'comment',
      },
    });

    const input = toContentInput(comment);

    expect(input.type).toBe('image');
    expect(input.url).toBe('https://i.redd.it/xyz789.png');
    expect(input.title).toBeUndefined();
    expect(input.text).toContain('Same spot');
  });

  it('routes a v.redd.it link as video, not image', () => {
    const post = recordFor({
      classification: 'social',
      dataSource: 'reddit',
      metadata: { Title: 'Clip', URL: 'https://v.redd.it/abcde12345', Kind: 'post' },
    });

    expect(toContentInput(post).type).toBe('video');
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

  describe('Reddit posts and comments', () => {
    it('files an authored post as outbound, subject = title, thread = subreddit', () => {
      const post = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Title: 'My post', Body: 'body text', Subreddit: 'aww', Kind: 'post' },
      });

      const input = toCommunicationInput(post);

      expect(input.communication_type).toBe(CommunicationType.POST);
      expect(input.direction).toBe('outbound');
      expect(input.subject).toBe('My post');
      expect(input.thread_id).toBe('r/aww');
    });

    it('files a SAVED post as inbound — it was written by someone else', () => {
      const saved = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Title: 'Someone else’s post', Subreddit: 'aww', Kind: 'saved_post' },
      });

      expect(toCommunicationInput(saved).direction).toBe('inbound');
    });

    it('leaves a comment’s subject blank — its body already carries the text in full', () => {
      const comment = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Body: 'a reply', Subreddit: 'aww', Kind: 'comment' },
      });

      const input = toCommunicationInput(comment);

      expect(input.subject).toBeUndefined();
      expect(input.content).toBe('a reply');
    });
  });

  describe('Discord attachment-only messages', () => {
    it('leaves content blank rather than synthesizing a "Message — sender" label', () => {
      const attachmentOnly = recordFor({
        classification: 'message',
        dataSource: 'discord',
        metadata: { Attachments: 'https://cdn.discordapp.com/a/1/pic.png?ex=1', Sender: 'alice' },
      });

      expect(toCommunicationInput(attachmentOnly).content).toBe('');
    });

    it('keeps real caption text for a message that has both text and an attachment', () => {
      const captioned = recordFor({
        classification: 'message',
        dataSource: 'discord',
        metadata: {
          Text: 'look at this',
          Attachments: 'https://cdn.discordapp.com/a/1/pic.png?ex=1',
        },
      });

      expect(toCommunicationInput(captioned).content).toBe('look at this');
    });
  });
});

describe('discordAttachmentContentInputs', () => {
  it('builds one content row per attachment, decoding the filename out of the signed URL', () => {
    const message = recordFor({
      classification: 'message',
      dataSource: 'discord',
      contentHash: 'msg-1',
      metadata: {
        Attachments:
          'https://cdn.discordapp.com/attachments/1/2/Screenshot%20from%202020.png?ex=1&is=2&hm=3 ' +
          'https://cdn.discordapp.com/attachments/1/2/config?ex=1',
      },
    });

    const inputs = discordAttachmentContentInputs(message);

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({
      type: 'media',
      title: 'Screenshot from 2020.png',
      mimetype: 'image/png',
      source_system: 'discord',
      source_id: 'msg-1:attachment:0',
    });
    // A bare extension-less file (Discord uploads include env/config files) —
    // mime-db can't type it at all, so it stays 'file' with no mimetype
    // guess. No type beats a wrong one.
    expect(inputs[1]).toMatchObject({ type: 'file', title: 'config', source_id: 'msg-1:attachment:1' });
    expect(inputs[1].mimetype).toBeUndefined();
  });

  it('is empty for a message with no attachments, and for a non-Discord source', () => {
    expect(discordAttachmentContentInputs(recordFor({ classification: 'message' }))).toEqual([]);

    const twitterDm = recordFor({
      classification: 'message',
      dataSource: 'twitter',
      metadata: { Attachments: 'https://cdn.discordapp.com/attachments/1/2/x.png' },
    });

    expect(discordAttachmentContentInputs(twitterDm)).toEqual([]);
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
