import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const LUCAS_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.PIZZA.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.TACOS.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.BBQ.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.CHINESE_FOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
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
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ANIMATION.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ACTION.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SCIFI.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
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
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.GAMING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SWIMMING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.CYCLING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.HIKING.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SMOOTHIES.id,
    toNodeType: 'entity',
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
];

export const LUCAS_DISLIKES: SeedRelationship[] = [
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.VEGETARIAN.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.85,
    properties: {
      reason: 'likes meat',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.SEAFOOD.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.95,
    properties: {
      reason: 'yuck!',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.ROMANCE.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'boring',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    fromNodeType: 'entity',
    toNodeId: concepts.YOGA.id,
    toNodeType: 'entity',
    type: RelationshipType.DISLIKES,
    strength: 0.8,
    properties: {
      reason: 'too slow',
    },
  },
];
