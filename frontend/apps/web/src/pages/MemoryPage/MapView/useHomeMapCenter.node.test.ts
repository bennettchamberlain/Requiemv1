import { describe, expect, it } from 'vitest';

import { HOME_TOWN_CITY_QUESTION_IDS, homeTownCatalogueUrl } from '@/pages/SelfPage/sections/lifeDetails';

import { pickHomeCity, pickHomePlace } from './useHomeMapCenter';

const CHILDHOOD_ID = HOME_TOWN_CITY_QUESTION_IDS[0];
const BIRTH_ID = HOME_TOWN_CITY_QUESTION_IDS[1];

describe('homeTownCatalogueUrl', () => {
  it('asks only for the two factual home-town city ids', () => {
    const url = new URL(homeTownCatalogueUrl(), 'https://example.test');

    expect(url.searchParams.get('ids')?.split(',')).toEqual([...HOME_TOWN_CITY_QUESTION_IDS]);
    expect(url.searchParams.get('limit')).toBe('2');
  });
});

describe('pickHomeCity', () => {
  it('prefers childhood city over birth city', () => {
    expect(
      pickHomeCity({
        data: [
          { id: BIRTH_ID, answer: { text: 'Detroit' } },
          { id: CHILDHOOD_ID, answer: { text: ' Oakland ' } },
        ],
      }),
    ).toBe('Oakland');
  });

  it('falls back to birth city when childhood is unanswered', () => {
    expect(
      pickHomeCity({
        data: [
          { id: CHILDHOOD_ID, answer: null },
          { id: BIRTH_ID, answer: { text: 'Detroit' } },
        ],
      }),
    ).toBe('Detroit');
  });

  it('returns null when neither city is answered', () => {
    expect(pickHomeCity({ data: [{ id: BIRTH_ID, answer: { text: '  ' } }] })).toBeNull();
    expect(pickHomeCity(null)).toBeNull();
  });
});

describe('pickHomePlace', () => {
  it('picks the located place whose name matches the city', () => {
    expect(
      pickHomePlace(
        [
          { node: { name: 'Oakland Airport', latitude: 37.71, longitude: -122.21 } },
          { node: { name: 'Oakland', latitude: 37.8, longitude: -122.27 } },
        ],
        'oakland',
      ),
    ).toEqual({ latitude: 37.8, longitude: -122.27 });
  });

  it('matches a city that includes the place name (San Francisco, CA)', () => {
    expect(
      pickHomePlace([{ node: { name: 'San Francisco', latitude: 37.77, longitude: -122.42 } }], 'San Francisco, CA'),
    ).toEqual({ latitude: 37.77, longitude: -122.42 });
  });

  it('skips places without coordinates and unmatched names', () => {
    expect(
      pickHomePlace(
        [
          { node: { name: 'Oakland', latitude: null, longitude: null } },
          { node: { name: 'Berkeley', latitude: 37.87, longitude: -122.27 } },
        ],
        'Oakland',
      ),
    ).toBeNull();
  });
});
