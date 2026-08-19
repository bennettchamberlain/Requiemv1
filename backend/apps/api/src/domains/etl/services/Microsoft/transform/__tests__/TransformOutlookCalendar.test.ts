import { OutlookCalendarTransformService } from '../TransformOutlookCalendar';

/**
 * Every constructor dependency mocked; `transformToEventDto` (private) is
 * exercised directly via a cast, matching the convention used elsewhere for
 * services whose public entry point orchestrates work unrelated to the thing
 * under test (see ContextPromptPersistService.spec.ts).
 */
function makeService() {
  const logger = {
    setContext: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  return new OutlookCalendarTransformService(
    {} as never, // MemoryEventService — unused by transformToEventDto
    {} as never, // ConnectionService — unused by transformToEventDto
    {} as never, // PromoteService — unused by transformToEventDto
    logger as never,
  );
}

function outlookEvent(displayName: string | null) {
  return {
    id: 'evt-1',
    subject: 'Standup',
    start: { dateTime: '2026-08-18T10:00:00Z' },
    end: { dateTime: '2026-08-18T10:30:00Z' },
    location: displayName == null ? undefined : { displayName },
    isRecurring: false,
    isAllDay: false,
    isCancelled: false,
  };
}

/**
 * `transformToEventDto` is private; this is the one place that reaches past
 * that to call it directly, so the `any` cast it requires stays contained
 * here instead of repeated at every call site.
 */
function callTransformToEventDto(
  service: OutlookCalendarTransformService,
  event: ReturnType<typeof outlookEvent>,
  userId: string,
  connectionId: string,
): Promise<{ location_name?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (service as any).transformToEventDto(event, userId, connectionId);
}

describe('OutlookCalendarTransformService.transformToEventDto — location_name', () => {
  it('refuses a Teams join link pasted into location.displayName', async () => {
    const service = makeService();
    const dto = await callTransformToEventDto(
      service,
      outlookEvent('https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc'),
      'user-1',
      'conn-1',
    );

    expect(dto.location_name).toBeUndefined();
  });

  it('refuses an AltspaceVR custom-scheme URI', async () => {
    const service = makeService();
    const dto = await callTransformToEventDto(
      service,
      outlookEvent('altspace://account.altvr.com/api/events/1629227784846967373'),
      'user-1',
      'conn-1',
    );

    expect(dto.location_name).toBeUndefined();
  });

  it('keeps a real venue name', async () => {
    const service = makeService();
    const dto = await callTransformToEventDto(
      service,
      outlookEvent('Conference Room 4B, HQ'),
      'user-1',
      'conn-1',
    );

    expect(dto.location_name).toBe('Conference Room 4B, HQ');
  });

  it('leaves location_name null when the event has no location at all', async () => {
    const service = makeService();
    const dto = await callTransformToEventDto(service, outlookEvent(null), 'user-1', 'conn-1');

    expect(dto.location_name).toBeUndefined();
  });
});
