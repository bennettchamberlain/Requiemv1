import { ParseStage } from '../ParseStage';

/**
 * `generic` returns `confidence: 1` without inspecting anything, so it matches
 * every archive — and ParseStage runs EVERY recognized source. On a real Google
 * Takeout that re-read what the specialised parsers had already read: 80,067
 * duplicate staged rows beside 309,689 Google Voice ones, 67,065 filenames
 * overlapping exactly. They pushed as contentless `ci.content` rows, and since
 * `ci.content` has no time column they sorted ahead of every genuine memory —
 * so the default Memory view became 80k empty stubs.
 *
 * Upstream did this selection in its drop zone; the layer was never ported.
 */

function match(name: string) {
  return { data_source: { name } } as never;
}

function names(matches: unknown[]): string[] {
  return (matches as Array<{ data_source: { name: string } }>).map((m) => m.data_source.name);
}

/** The method is private by design — this is the one place that reaches in. */
function select(stage: ParseStage, matches: unknown[]): unknown[] {
  return (
    stage as unknown as { dropGenericWhenSpecialised: (m: unknown[]) => unknown[] }
  ).dropGenericWhenSpecialised(matches);
}

describe('ParseStage generic exclusion', () => {
  const stage = new ParseStage({ manager: {} } as never, { setContext: jest.fn() } as never);

  it('drops generic when a real parser also claimed the tree', () => {
    const selected = select(stage, [match('google_voice'), match('generic'), match('google_photos')]);

    expect(names(selected)).toEqual(['google_voice', 'google_photos']);
  });

  it('keeps generic when it is the only match', () => {
    // The bare-.gpx / loose-PDF drag: generic is the whole point there.
    const selected = select(stage, [match('generic')]);

    expect(names(selected)).toEqual(['generic']);
  });

  it('leaves a purely specialised match set alone', () => {
    const selected = select(stage, [match('gmail'), match('calendar')]);

    expect(names(selected)).toEqual(['gmail', 'calendar']);
  });

  it('passes an empty match set through untouched', () => {
    expect(select(stage, [])).toEqual([]);
  });
});
