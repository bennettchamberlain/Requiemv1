import * as concepts from '../concepts';
import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const LUCAS_PREFERS: SeedRelationship[] = [
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.PIZZA.id,
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.TACOS.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.BBQ.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.CHINESE_FOOD.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.ITALIAN_CUISINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.75,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.ANIMATION.id,
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.ACTION.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.SCIFI.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.COMEDY.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.GAMING.id,
    type: RelationshipType.PREFERS,
    strength: 1.0,
    properties: {
      context: 'always loved',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.SWIMMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'childhood',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'discovered',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'recent',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.SMOOTHIES.id,
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
    toNodeId: concepts.VEGETARIAN.id,
    type: RelationshipType.DISLIKES,
    strength: 0.85,
    properties: {
      reason: 'likes meat',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.SEAFOOD.id,
    type: RelationshipType.DISLIKES,
    strength: 0.95,
    properties: {
      reason: 'yuck!',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.ROMANCE.id,
    type: RelationshipType.DISLIKES,
    strength: 0.9,
    properties: {
      reason: 'boring',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: concepts.YOGA.id,
    type: RelationshipType.DISLIKES,
    strength: 0.8,
    properties: {
      reason: 'too slow',
    },
  },
];
