import { describe, expect, it } from 'vitest';

import {
  colorForRawType,
  DEFAULT_ENTITY_VISUAL,
  ENTITY_VISUALS,
  kindFromRawType,
  kindFromTypename,
  visualForRawType,
  visualForTypename,
} from './entityVisuals';

describe('kindFromTypename', () => {
  it('maps a GraphQL union __typename to its kind', () => {
    expect(kindFromTypename('PlaceType')).toBe('place');
    expect(kindFromTypename('PersonType')).toBe('person');
  });

  it('returns null for an unmapped or missing typename', () => {
    expect(kindFromTypename('SomeOtherType')).toBeNull();
    expect(kindFromTypename(null)).toBeNull();
    expect(kindFromTypename(undefined)).toBeNull();
  });
});

describe('kindFromRawType', () => {
  it('normalizes whitespace and casing before matching', () => {
    expect(kindFromRawType('  Person  ')).toBe('person');
    expect(kindFromRawType('PLACE')).toBe('place');
  });

  it('maps backend aliases onto their canonical kind', () => {
    expect(kindFromRawType('location')).toBe('place');
    expect(kindFromRawType('Object')).toBe('item');
    expect(kindFromRawType('thing')).toBe('item');
    expect(kindFromRawType('Contact')).toBe('person');
    expect(kindFromRawType('message')).toBe('communication');
    expect(kindFromRawType('communications')).toBe('communication');
    expect(kindFromRawType('Browser Activity')).toBe('browser-activity');
    expect(kindFromRawType('browseractivity')).toBe('browser-activity');
    expect(kindFromRawType('WebPage')).toBe('browser-activity');
  });

  it('tolerates a trailing plural "s" once no direct or alias match is found', () => {
    expect(kindFromRawType('events')).toBe('event');
    expect(kindFromRawType('places')).toBe('place');
  });

  it('returns null for empty or unrecognized values', () => {
    expect(kindFromRawType('')).toBeNull();
    expect(kindFromRawType(null)).toBeNull();
    expect(kindFromRawType(undefined)).toBeNull();
    expect(kindFromRawType('completely-unknown-kind')).toBeNull();
  });
});

describe('visualForTypename / visualForRawType / colorForRawType', () => {
  it('returns the matching visual for a known kind', () => {
    expect(visualForTypename('EventType')).toBe(ENTITY_VISUALS.event);
    expect(visualForRawType('location')).toBe(ENTITY_VISUALS.place);
    expect(colorForRawType('location')).toBe(ENTITY_VISUALS.place.color);
  });

  it('falls back to the neutral default visual for anything unrecognized', () => {
    expect(visualForTypename('MysteryType')).toBe(DEFAULT_ENTITY_VISUAL);
    expect(visualForRawType('mystery-kind')).toBe(DEFAULT_ENTITY_VISUAL);
    expect(colorForRawType(null)).toBe(DEFAULT_ENTITY_VISUAL.color);
  });
});
