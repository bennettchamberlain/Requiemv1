import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const SARAH_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.MEDITERRANEAN.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.THAI_FOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.VEGETARIAN.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SUSHI.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ITALIAN_CUISINE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DRAMA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ROMANCE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DOCUMENTARY.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.COMEDY.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.YOGA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.RUNNING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.READING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.PAINTING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.TEA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.WINE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SMOOTHIES.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'discovered',
    },
  },
];

export const SARAH_DISLIKES: SeedRelationship[] = [
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.HORROR.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.85,
    properties: {
      reason: 'too intense',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.BBQ.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'health reasons',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.BEER.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.8,
    properties: {
      reason: 'taste preference',
    },
  },
];
