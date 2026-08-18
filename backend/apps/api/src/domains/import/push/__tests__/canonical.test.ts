import type { StagedItem } from '../../entities/StagedItemEntity';
import {
  destinationsFor,
  discordAttachmentFilename,
  discordAttachmentUrls,
  isDiscordAttachmentOnly,
  isRedditComment,
  isRedditPost,
  kindFor,
  redditMediaUrl,
  toCanonical,
  type CanonicalRecord,
} from '../canonical';

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

  it('gives a dated photo a content row so its thumbnail can resolve', () => {
    // EventMediaLoader resolves an event's photo/video by INNER-JOINing
    // ci.content on ci.events through the shared source triple
    // (ContentService.findMediaFilesByEventIds). ['events'] alone never
    // creates that content row, so the join finds nothing and the tile is
    // blank — verified on a real import: 2,098 photo/video events, 0 linked.
    const photo = recordFor({
      classification: 'photo',
      mediaType: 'image/jpeg',
      intermediateLocation: '/scratch/IMG_0001.jpg',
    });

    expect(destinationsFor(photo)).toEqual(['events', 'content']);
  });

  it('gives a geotagged photo events, content, AND a position donation', () => {
    const photo = recordFor({
      classification: 'photo',
      mediaType: 'image/jpeg',
      intermediateLocation: '/scratch/IMG_0001.jpg',
      latitude: 1,
      longitude: 2,
    });

    expect(destinationsFor(photo)).toEqual(['events', 'content', 'position']);
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

  describe('Reddit posts and comments', () => {
    // Authored communications, not timeline events — a content row rides
    // along ONLY when the record carries media (see inputs.test.ts's
    // toContentInput coverage for the row's shape).

    it('sends a text-only post to communications alone', () => {
      const textPost = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Title: 'A wall of text', Kind: 'post', Subreddit: 'AskReddit' },
      });

      expect(destinationsFor(textPost)).toEqual(['communications']);
    });

    it('adds a content row when the post links to media', () => {
      const imagePost = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Title: 'Sunset', URL: 'https://i.redd.it/abc.jpg', Kind: 'post', Subreddit: 'pics' },
      });

      expect(destinationsFor(imagePost)).toEqual(['communications', 'content']);
    });

    it('adds a content row when a comment links to media in its body', () => {
      const comment = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Body: 'same here: https://i.redd.it/xyz.png', Kind: 'comment', Subreddit: 'pics' },
      });

      expect(destinationsFor(comment)).toEqual(['communications', 'content']);
    });

    it('does not treat an ordinary social vote/subreddit row as a post or comment', () => {
      // Only Kind 'post'/'saved_post'/'comment'/'saved_comment' qualify — other
      // reddit exports (subscribed subreddits) keep the generic social.* route.
      const subscription = recordFor({
        classification: 'social',
        dataSource: 'reddit',
        metadata: { Kind: 'subscribed', Subreddit: 'pics' },
      });

      expect(destinationsFor(subscription)).toEqual(['events', 'content']);
    });
  });
});

describe('isRedditPost / isRedditComment', () => {
  it('is true only for reddit rows carrying the matching Kind', () => {
    const post = recordFor({ dataSource: 'reddit', metadata: { Kind: 'post' } });
    const savedPost = recordFor({ dataSource: 'reddit', metadata: { Kind: 'saved_post' } });
    const comment = recordFor({ dataSource: 'reddit', metadata: { Kind: 'comment' } });

    expect(isRedditPost(post)).toBe(true);
    expect(isRedditPost(savedPost)).toBe(true);
    expect(isRedditPost(comment)).toBe(false);
    expect(isRedditComment(comment)).toBe(true);
  });

  it('is false for a non-reddit source even with a matching Kind value', () => {
    // The dataSource check comes first — a coincidental Kind:'post' from
    // another importer must not be read as an authored reddit post.
    const lookalike = recordFor({ dataSource: 'some_other_source', metadata: { Kind: 'post' } });

    expect(isRedditPost(lookalike)).toBe(false);
  });
});

describe('redditMediaUrl', () => {
  it('reads a link post’s media from its URL field', () => {
    const post = recordFor({
      dataSource: 'reddit',
      metadata: { Kind: 'post', URL: 'https://i.redd.it/a.jpg' },
    });

    expect(redditMediaUrl(post)).toEqual({ url: 'https://i.redd.it/a.jpg', kind: 'image' });
  });

  it('is null for a post whose URL is not a recognised media link (a self-post permalink)', () => {
    const selfPost = recordFor({
      dataSource: 'reddit',
      metadata: { Kind: 'post', URL: 'https://reddit.com/r/pics/comments/abc123/my_post/' },
    });

    expect(redditMediaUrl(selfPost)).toBeNull();
  });

  it('finds the first media link inside a comment’s body markdown', () => {
    const comment = recordFor({
      dataSource: 'reddit',
      metadata: {
        Kind: 'comment',
        Body: 'not media: https://example.com, but this is: https://v.redd.it/clip1',
      },
    });

    expect(redditMediaUrl(comment)).toEqual({ url: 'https://v.redd.it/clip1', kind: 'video' });
  });

  it('is null for a comment whose body has no media link at all', () => {
    const comment = recordFor({ dataSource: 'reddit', metadata: { Kind: 'comment', Body: 'just words' } });

    expect(redditMediaUrl(comment)).toBeNull();
  });

  it('strips trailing punctuation a sentence wraps the link in', () => {
    const comment = recordFor({
      dataSource: 'reddit',
      metadata: { Kind: 'comment', Body: 'check this out (https://i.redd.it/trailing.png).' },
    });

    expect(redditMediaUrl(comment)?.url).toBe('https://i.redd.it/trailing.png');
  });
});

describe('Discord attachments', () => {
  describe('discordAttachmentUrls', () => {
    it('splits space-separated links off a multi-attachment message', () => {
      const message = recordFor({
        dataSource: 'discord',
        metadata: {
          Attachments: 'https://cdn.discordapp.com/a/1/x.png https://cdn.discordapp.com/a/1/y.png',
        },
      });

      expect(discordAttachmentUrls(message)).toEqual([
        'https://cdn.discordapp.com/a/1/x.png',
        'https://cdn.discordapp.com/a/1/y.png',
      ]);
    });

    it('is empty for a non-Discord source even with an Attachments-shaped field', () => {
      const notDiscord = recordFor({
        dataSource: 'imessage',
        metadata: { Attachments: 'https://cdn.discordapp.com/a/1/x.png' },
      });

      expect(discordAttachmentUrls(notDiscord)).toEqual([]);
    });

    it('is empty when the field is absent', () => {
      expect(discordAttachmentUrls(recordFor({ dataSource: 'discord' }))).toEqual([]);
    });
  });

  describe('discordAttachmentFilename', () => {
    it('decodes a percent-encoded name and drops the signature query string', () => {
      const url = 'https://cdn.discordapp.com/attachments/1/2/Screenshot%20from%202020.png?ex=1&is=2&hm=3';

      expect(discordAttachmentFilename(url)).toBe('Screenshot from 2020.png');
    });

    it('is undefined for an unparseable URL', () => {
      expect(discordAttachmentFilename('not a url')).toBeUndefined();
    });
  });

  describe('isDiscordAttachmentOnly', () => {
    it('is true for a Discord message with attachments and no text', () => {
      const message = recordFor({
        dataSource: 'discord',
        metadata: { Attachments: 'https://cdn.discordapp.com/a/1/x.png' },
      });

      expect(isDiscordAttachmentOnly(message)).toBe(true);
    });

    it('is false once the message carries a caption', () => {
      const captioned = recordFor({
        dataSource: 'discord',
        metadata: { Text: 'look!', Attachments: 'https://cdn.discordapp.com/a/1/x.png' },
      });

      expect(isDiscordAttachmentOnly(captioned)).toBe(false);
    });

    it('is false for a Discord message with no attachments at all', () => {
      expect(isDiscordAttachmentOnly(recordFor({ dataSource: 'discord' }))).toBe(false);
    });
  });
});
