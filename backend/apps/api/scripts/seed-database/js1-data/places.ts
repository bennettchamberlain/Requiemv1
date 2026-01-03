import { type CreatePlaceDto } from '@ci/domains/memory/types';

type SeedPlace = RequiredFields<CreatePlaceDto, 'id'>;

export const SMITH_FAMILY_HOME: SeedPlace = {
  id: '019b7de5-e2d3-7562-b14a-756fae22ca3e',
  name: 'Smith Family Home',
  description: 'Family residence in a quiet suburban neighborhood',
  properties: {
    type: 'Residence',
    latitude: 33.5427,
    longitude: -117.7854,
    address: '123 Maple Street, Laguna Beach, CA',
    bedrooms: 4,
    neighborhood: 'Generic area',
  },
};

export const PLACES: SeedPlace[] = [
  SMITH_FAMILY_HOME,

  {
    id: '019b7de5-e2d3-7562-b14a-7a5b85135b3c',
    name: 'Acme Construction HQ',
    properties: {
      type: 'Work Site',
      latitude: 34.03,
      longitude: -118.48,
      address: 'Acme Construction HQ, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-7fd818945a42',
    name: 'Highway Overpass Project Site A',
    properties: {
      type: 'Work Site',
      latitude: 34.04,
      longitude: -118.51,
      address: 'Highway Overpass Project Site A, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-80b5e28d49bc',
    name: 'Santa Monica Fitness Gym',
    properties: {
      type: 'Gym',
      latitude: 34.015,
      longitude: -118.495,
      address: 'Santa Monica Fitness Gym, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-86a9137d931d',
    name: 'Ocean View Park',
    properties: {
      type: 'Park',
      latitude: 34.01,
      longitude: -118.498,
      address: 'Ocean View Park, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-8943b0f1a9d3',
    name: "St. Michael's Private School",
    properties: {
      type: 'School',
      latitude: 34.025,
      longitude: -118.485,
      address: "St. Michael's Private School, USA",
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-8c930c85b1d4',
    name: 'SoundWave Studios',
    properties: {
      type: 'Music Studio',
      latitude: 34.035,
      longitude: -118.47,
      address: 'SoundWave Studios, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-9284f2fb618d',
    name: 'The Rhythm Room',
    properties: {
      type: 'Music Studio',
      latitude: 34.032,
      longitude: -118.475,
      address: 'The Rhythm Room, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-96dabe351fb4',
    name: 'Westside Park Soccer Field',
    properties: {
      type: 'Park',
      latitude: 34.018,
      longitude: -118.505,
      address: 'Westside Park Soccer Field, USA',
    },
  },
  {
    id: '019b7de5-e2d3-7562-b14a-991e98d80366',
    name: "Tina's Ballet Academy",
    properties: {
      type: 'School',
      latitude: 34.028,
      longitude: -118.488,
      address: "Tina's Ballet Academy, USA",
    },
  },
  //  Conference and travel locations
  {
    id: '019b7de5-e2d4-752b-9f5d-31f9f763ffa7',
    name: 'GreenBuild Conference Center LA',
    properties: {
      type: 'Conference Center',
      latitude: 34.0522,
      longitude: -118.2437,
      address: 'GreenBuild Conference Center LA, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-35271fac0d32',
    name: 'Palm Springs Getaway Hotel',
    properties: {
      type: 'Hotel',
      latitude: 33.8303,
      longitude: -116.5453,
      address: 'Palm Springs Getaway Hotel, USA',
    },
  },

  // Additional local places (clinics, gyms, work sites, music venues, parks)
  {
    id: '019b7de5-e2d4-752b-9f5d-3a1556c7d581',
    name: 'Local Clinic 1',
    properties: {
      type: 'Clinic',
      latitude: 34.005222,
      longitude: -118.46844,
      address: 'Local Clinic 1, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-3d6b94210139',
    name: 'Local Clinic 2',
    properties: {
      type: 'Clinic',
      latitude: 34.02045,
      longitude: -118.463387,
      address: 'Local Clinic 2, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-43419ec8ef48',
    name: 'Local Clinic 3',
    properties: {
      type: 'Clinic',
      latitude: 34.009594,
      longitude: -118.49982,
      address: 'Local Clinic 3, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-45e4fcb2c3fe',
    name: 'Westside Gym',
    properties: {
      type: 'Gym',
      latitude: 34.032695,
      longitude: -118.496525,
      address: 'Westside Gym, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-4a6a3baa8588',
    name: 'Fitness Center',
    properties: {
      type: 'Gym',
      latitude: 34.032988,
      longitude: -118.473816,
      address: 'Fitness Center, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-4d2afedb7e20',
    name: 'Work Site B',
    properties: {
      type: 'Work Site',
      latitude: 34.049869,
      longitude: -118.454499,
      address: 'Work Site B, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-530739f98ecc',
    name: 'Work Site C',
    properties: {
      type: 'Work Site',
      latitude: 33.990009,
      longitude: -118.473709,
      address: 'Work Site C, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-554786b41b00',
    name: 'Work Site D',
    properties: {
      type: 'Work Site',
      latitude: 34.031064,
      longitude: -118.495344,
      address: 'Work Site D, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-5b390fa42578',
    name: 'Community Park',
    properties: {
      type: 'Park',
      latitude: 34.046953,
      longitude: -118.460672,
      address: 'Community Park, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-5cd365d828ae',
    name: 'Recreation Park',
    properties: {
      type: 'Park',
      latitude: 33.998429,
      longitude: -118.464188,
      address: 'Recreation Park, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-60269d6bd944',
    name: 'Music Studio A',
    properties: {
      type: 'Music Studio',
      latitude: 34.005949,
      longitude: -118.49511,
      address: 'Music Studio A, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-649013a68ff4',
    name: 'Music Studio B',
    properties: {
      type: 'Music Studio',
      latitude: 33.996748,
      longitude: -118.471949,
      address: 'Music Studio B, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-690dd8796751',
    name: 'Music Studio C',
    properties: {
      type: 'Music Studio',
      latitude: 34.030576,
      longitude: -118.478376,
      address: 'Music Studio C, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-6df8abc047c3',
    name: 'Conference Center A',
    properties: {
      type: 'Conference Center',
      latitude: 33.991395,
      longitude: -118.472243,
      address: 'Conference Center A, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-73469f8f0688',
    name: 'Conference Center B',
    properties: {
      type: 'Conference Center',
      latitude: 34.041697,
      longitude: -118.492042,
      address: 'Conference Center B, USA',
    },
  },
  {
    id: '019b7de5-e2d4-752b-9f5d-74a3db52baab',
    name: 'Conference Center C',
    properties: {
      type: 'Conference Center',
      latitude: 34.044401,
      longitude: -118.452686,
      address: 'Conference Center C, USA',
    },
  },
];
