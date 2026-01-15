import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const EMMA_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.PIZZA.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.MEXICAN_FOOD.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.SUSHI.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.ITALIAN_CUISINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.THAI_FOOD.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.ANIMATION.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.ROMANCE.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.COMEDY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.DRAMA.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.PAINTING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.DANCING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.SMOOTHIES.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.TEA.id,
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'discovered',
    },
  },
];

export const EMMA_DISLIKES: SeedRelationship[] = [
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.HORROR.id,
    type: RelationshipType.DISLIKES,
    strength: 1.0,
    properties: {
      reason: 'nightmares',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.SEAFOOD.id,
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'texture issues',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: concepts.RUNNING.id,
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'prefer other activities',
    },
  },
];
