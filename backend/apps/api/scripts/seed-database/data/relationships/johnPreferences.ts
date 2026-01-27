import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const JOHN_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ITALIAN_CUISINE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.PIZZA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.BBQ.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.THAI_FOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SUSHI.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SCIFI.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ACTION.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.THRILLER.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DRAMA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.65,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.HIKING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.READING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.CYCLING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.COFFEE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.BEER.id,
    toNodeType: 'entity',
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
    fromNodeType: 'entity',
    toNodeId: concepts.HORROR.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'too scary',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SEAFOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'allergies',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DANCING.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.6,
    properties: {
      reason: 'not my thing',
    },
  },
];
