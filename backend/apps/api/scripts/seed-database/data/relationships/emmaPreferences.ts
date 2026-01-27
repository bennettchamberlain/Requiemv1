import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const EMMA_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.PIZZA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.MEXICAN_FOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SUSHI.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ITALIAN_CUISINE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.THAI_FOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.7,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ANIMATION.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ROMANCE.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.COMEDY.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DRAMA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.PAINTING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.READING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.DANCING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.WRITING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SMOOTHIES.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.TEA.id,
    toNodeType: 'entity',
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
    fromNodeType: 'entity',
    toNodeId: concepts.HORROR.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 1.0,
    properties: {
      reason: 'nightmares',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SEAFOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'texture issues',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.RUNNING.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.7,
    properties: {
      reason: 'prefer other activities',
    },
  },
];
