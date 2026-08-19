import { destinationsFor } from '../../push/canonical';
import { DESTINATION_ORDER } from '../PushStage';

/**
 * `DESTINATION_ORDER` is a hand-maintained list, and `destinationsFor` is the
 * function it claims to be consistent with. Nothing connected the two, so the
 * batching refactor could invert `events`/`content` without a single test
 * noticing — and it did, leaving `ci.content.event_id` NULL on all 41,851 rows
 * of a real corpus and blanking every gallery thumbnail.
 *
 * These assert the RELATIONSHIP rather than the literal array, so they keep
 * holding when a destination is added.
 */
describe('DESTINATION_ORDER agrees with destinationsFor', () => {
  /** Kinds `destinationsFor` routes to more than one destination. */
  const MULTI_DESTINATION_KINDS = [
    'social.post',
    'media.play',
    'media.watch',
    'media.listen',
    'media.read',
    'capture.photo',
    'calendar.event',
    'communication.message',
  ];

  const rank = (d: string): number => DESTINATION_ORDER.indexOf(d as never);

  it.each(MULTI_DESTINATION_KINDS)(
    'writes %s destinations in the same relative order destinationsFor lists them',
    (kind) => {
      // A file-bearing record, so the branches gated on a file are exercised too.
      const rec = { kind, mediaType: 'image/jpeg', mediaPath: '/tmp/x.jpg' } as never;
      const destinations = destinationsFor(rec).filter((d) => rank(d) >= 0);

      const ranks = destinations.map(rank);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    },
  );

  it('writes events before content, because content auto-links to its event by triple', () => {
    // The specific inversion that shipped. ContentService.createManyDetailed
    // resolves event_id by provenance triple at insert time, so a content row
    // written first can never find its event.
    expect(rank('events')).toBeLessThan(rank('content'));
  });

  it('still writes communications before content, for reddit', () => {
    // reddit is the one branch returning ['communications', 'content'].
    expect(rank('communications')).toBeLessThan(rank('content'));
  });
});
