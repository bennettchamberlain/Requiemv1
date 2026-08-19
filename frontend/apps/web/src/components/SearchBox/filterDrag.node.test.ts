/**
 * The wire format for dragging a person/place/tag search result onto the
 * Memory explorer's filter drop area. Pure logic (no DOM needed — a fake
 * DataTransfer is enough), so this runs in the node project.
 */
import { describe, expect, it } from 'vitest';

import {
  FILTER_DRAG_TYPE,
  type FilterDragPayload,
  isFilterDrag,
  readFilterDrag,
  startFilterDrag,
} from './filterDrag';

/** A minimal DataTransfer stand-in, just enough for these functions to operate on. */
function fakeDataTransfer(initial: Record<string, string> = {}) {
  const store = { ...initial };

  return {
    get types() {
      return Object.keys(store);
    },
    getData: (key: string) => store[key] ?? '',
    setData: (key: string, value: string) => {
      store[key] = value;
    },
    effectAllowed: '',
  };
}

function dragEvent(dataTransfer: ReturnType<typeof fakeDataTransfer>) {
  return { dataTransfer } as unknown as React.DragEvent;
}

describe('startFilterDrag / readFilterDrag round-trip', () => {
  it('writes both the custom type and a text/plain fallback', () => {
    const dt = fakeDataTransfer();
    startFilterDrag(dragEvent(dt), 'person', 'Alice');

    expect(dt.getData(FILTER_DRAG_TYPE)).toBe(JSON.stringify({ kind: 'person', name: 'Alice' }));
    expect(dt.getData('text/plain')).toBe('Alice');
    expect(dt.effectAllowed).toBe('copy');
  });

  it('reads back exactly what was written', () => {
    const dt = fakeDataTransfer();
    startFilterDrag(dragEvent(dt), 'place', 'Berlin');

    const payload = readFilterDrag(dragEvent(dt));

    expect(payload).toEqual<FilterDragPayload>({ kind: 'place', name: 'Berlin' });
  });

  it('round-trips a tag', () => {
    const dt = fakeDataTransfer();
    startFilterDrag(dragEvent(dt), 'tag', 'vacation');

    expect(readFilterDrag(dragEvent(dt))).toEqual({ kind: 'tag', name: 'vacation' });
  });
});

describe('isFilterDrag', () => {
  it('is true only when the custom type key is present', () => {
    expect(isFilterDrag(dragEvent(fakeDataTransfer({ [FILTER_DRAG_TYPE]: '{}' })))).toBe(true);
    expect(isFilterDrag(dragEvent(fakeDataTransfer({ 'text/plain': 'hello' })))).toBe(false);
    expect(isFilterDrag(dragEvent(fakeDataTransfer()))).toBe(false);
  });
});

describe('readFilterDrag rejects anything that is not a filter payload', () => {
  it('returns null when the type key is absent entirely', () => {
    expect(readFilterDrag(dragEvent(fakeDataTransfer()))).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    const dt = fakeDataTransfer({ [FILTER_DRAG_TYPE]: 'not json{' });

    expect(() => readFilterDrag(dragEvent(dt))).not.toThrow();
    expect(readFilterDrag(dragEvent(dt))).toBeNull();
  });

  it('returns null for a kind outside the known set', () => {
    const dt = fakeDataTransfer({ [FILTER_DRAG_TYPE]: JSON.stringify({ kind: 'event', name: 'x' }) });

    expect(readFilterDrag(dragEvent(dt))).toBeNull();
  });

  it('returns null when name is missing or not a string', () => {
    const missing = fakeDataTransfer({ [FILTER_DRAG_TYPE]: JSON.stringify({ kind: 'person' }) });
    const wrongType = fakeDataTransfer({ [FILTER_DRAG_TYPE]: JSON.stringify({ kind: 'person', name: 42 }) });

    expect(readFilterDrag(dragEvent(missing))).toBeNull();
    expect(readFilterDrag(dragEvent(wrongType))).toBeNull();
  });

  it('returns null for a JSON payload that is not an object (e.g. a bare string or array)', () => {
    const bareString = fakeDataTransfer({ [FILTER_DRAG_TYPE]: JSON.stringify('person:Alice') });
    const array = fakeDataTransfer({ [FILTER_DRAG_TYPE]: JSON.stringify(['person', 'Alice']) });

    expect(readFilterDrag(dragEvent(bareString))).toBeNull();
    // Arrays are technically typeof 'object' and not null — this pins that an
    // array still fails because it has no `kind`/`name` keys, rather than by
    // some earlier typeof check that happens to also reject it.
    expect(readFilterDrag(dragEvent(array))).toBeNull();
  });
});
