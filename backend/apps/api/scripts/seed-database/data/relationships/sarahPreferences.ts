import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const SARAH_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.MEDITERRANEAN.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.THAI_FOOD.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.VEGETARIAN.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.SUSHI.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.ITALIAN_CUISINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.DRAMA.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.ROMANCE.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.DOCUMENTARY.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.COMEDY.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.YOGA.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.RUNNING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.TEA.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.WINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'acquired taste',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.SMOOTHIES.id,
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
    toNodeId: concepts.HORROR.id,
    type: RelationshipType.DISLIKES,
    strength: 0.85,
    properties: {
      reason: 'too intense',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.BBQ.id,
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'health reasons',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.DISLIKES,
    strength: 0.8,
    properties: {
      reason: 'taste preference',
    },
  },
];
