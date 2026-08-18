import { HttpException, HttpStatus } from '@nestjs/common';

import { AskRateLimitService } from './AskRateLimitService';

function makeService() {
  const logger = { setContext: jest.fn() };

  return new AskRateLimitService(logger as never);
}

describe('AskRateLimitService.consume', () => {
  it('allows attempts under the per-user limit', () => {
    const service = makeService();

    for (let i = 0; i < 20; i++) {
      expect(() => service.consume('asker-1', 1_000 + i)).not.toThrow();
    }
  });

  it('throws HTTP 429 once a SINGLE user exceeds the window limit', () => {
    const service = makeService();

    for (let i = 0; i < 20; i++) {
      service.consume('asker-1', 1_000 + i);
    }

    let caught: unknown;
    try {
      service.consume('asker-1', 1_020);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((caught as HttpException).getResponse()).toMatchObject({
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      retryAfterMs: expect.any(Number),
    });
  });

  // The abuse control is PER-ASKER. A shared key (e.g. a bug that keyed the
  // window on something constant, or on the responder instead of the asker)
  // would let one asker's flood exhaust every other asker's allowance against
  // the same responder's inbox.
  it('keeps each userId in its OWN window — one user hitting the limit does not throttle another', () => {
    const service = makeService();

    for (let i = 0; i < 20; i++) {
      service.consume('asker-flood', 1_000 + i);
    }

    expect(() => service.consume('asker-flood', 1_020)).toThrow(HttpException);

    // A different asker, same instant, must be unaffected.
    expect(() => service.consume('asker-quiet', 1_020)).not.toThrow();
  });

  it('lets a user retry once their window has slid past the offending attempts', () => {
    const service = makeService();

    for (let i = 0; i < 20; i++) {
      service.consume('asker-1', i * 1000); // spread across the window
    }

    expect(() => service.consume('asker-1', 19_000)).toThrow(HttpException);

    // 61 seconds after the first attempt: the whole first window has expired.
    expect(() => service.consume('asker-1', 61_000)).not.toThrow();
  });
});
