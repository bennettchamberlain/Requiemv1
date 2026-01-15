import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const JOHN_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.ITALIAN_CUISINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.PIZZA.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.BBQ.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.THAI_FOOD.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.SUSHI.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.SCIFI.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.ACTION.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.THRILLER.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.DRAMA.id,
    type: RelationshipType.PREFERS,
    strength: 0.65,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.COFFEE.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'discovered',
    },
  },
];

export const JOHN_DISLIKES: SeedRelationship[] = [
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.HORROR.id,
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'too scary',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.SEAFOOD.id,
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'allergies',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: concepts.DANCING.id,
    type: RelationshipType.DISLIKES,
    strength: 0.6,
    properties: {
      reason: 'not my thing',
    },
  },
];
