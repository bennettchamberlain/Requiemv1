import { RelationshipType } from '@ci/domains/graph';
import { type CreateRelationshipDto } from '@ci/domains/graph/types';

import * as concepts from './concepts';
import * as people from './people';
import * as places from './places';

const SMITH_FAMILY_RELATIONSHIPS: CreateRelationshipDto[] = [
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.SARAH_SMITH.id,
    type: RelationshipType.SPOUSE,
    strength: 1.0,
    properties: {
      married_since: '2008-06-15',
      anniversary: 'June 15',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: people.JOHN_SMITH.id,
    type: RelationshipType.SPOUSE,
    strength: 1.0,
    properties: {
      married_since: '2008-06-15',
      anniversary: 'June 15',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.EMMA_SMITH.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'father-daughter',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: people.EMMA_SMITH.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-daughter',
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.LUCAS_SMITH.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'father-son',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: people.LUCAS_SMITH.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: people.LUCAS_SMITH.id,
    type: RelationshipType.SIBLING_OF,
    strength: 1.0,
    properties: {
      relationship: 'older-sister',
      age_gap: 4,
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: people.EMMA_SMITH.id,
    type: RelationshipType.SIBLING_OF,
    strength: 1.0,
    properties: {
      relationship: 'younger-brother',
      age_gap: 4,
    },
  },
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: places.SMITH_FAMILY_HOME.id,
    type: RelationshipType.LIVES_IN,
    strength: 1.0,
    properties: {
      since: '2015-06-01',
    },
  },
  {
    fromNodeId: people.SARAH_SMITH.id,
    toNodeId: places.SMITH_FAMILY_HOME.id,
    type: RelationshipType.LIVES_IN,
    strength: 1.0,
    properties: {
      since: '2015-06-01',
    },
  },
  {
    fromNodeId: people.EMMA_SMITH.id,
    toNodeId: places.SMITH_FAMILY_HOME.id,
    type: RelationshipType.LIVES_IN,
    strength: 1.0,
    properties: {
      since: '2015-06-01',
    },
  },
  {
    fromNodeId: people.LUCAS_SMITH.id,
    toNodeId: places.SMITH_FAMILY_HOME.id,
    type: RelationshipType.LIVES_IN,
    strength: 1.0,
    properties: {
      since: '2015-06-01',
    },
  },
];

const JOHN_PREFERS: CreateRelationshipDto[] = [
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

const SARAH_PREFERS: CreateRelationshipDto[] = [
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

const EMMA_PREFERS: CreateRelationshipDto[] = [
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

const LUCAS_PREFERS: CreateRelationshipDto[] = [
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

const JOHN_DISLIKES: CreateRelationshipDto[] = [
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

const SARAH_DISLIKES: CreateRelationshipDto[] = [
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

const EMMA_DISLIKES: CreateRelationshipDto[] = [
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

const LUCAS_DISLIKES: CreateRelationshipDto[] = [
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

const COWORKER_RELATIONSHIPS: CreateRelationshipDto[] = [
  // David Chen
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.DAVID_CHEN.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.DAVID_CHEN.id,
    toNodeId: concepts.MACHINE_LEARNING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },
  {
    fromNodeId: people.DAVID_CHEN.id,
    toNodeId: concepts.COFFEE.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'daily ritual',
    },
  },

  // Emily White
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.EMILY_WHITE.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.EMILY_WHITE.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
    properties: {
      context: 'weekend activity',
    },
  },
  {
    fromNodeId: people.EMILY_WHITE.id,
    toNodeId: concepts.TRAVEL.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
    properties: {
      context: 'vacation',
    },
  },

  // Marcus Johnson
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.MARCUS_JOHNSON.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.MARCUS_JOHNSON.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Sarah Jenkins
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.SARAH_JENKINS.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },

  // Michael Chang
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.MICHAEL_CHANG.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.MICHAEL_CHANG.id,
    toNodeId: concepts.GAMING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'hobby',
    },
  },
  {
    fromNodeId: people.MICHAEL_CHANG.id,
    toNodeId: concepts.SCIFI.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'favorite genre',
    },
  },

  // Lisa Patel
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.LISA_PATEL.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },

  // Robert Vance
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.ROBERT_VANCE.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.ROBERT_VANCE.id,
    toNodeId: concepts.COOKING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Jennifer Wu
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.JENNIFER_WU.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.JENNIFER_WU.id,
    toNodeId: concepts.MACHINE_LEARNING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Kevin O'Connor
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.KEVIN_OCONNOR.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },

  // Rachel Green
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.RACHEL_GREEN.id,
    type: RelationshipType.WORKS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.RACHEL_GREEN.id,
    toNodeId: concepts.YOGA.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'wellness',
    },
  },
];

const FRIEND_RELATIONSHIPS: CreateRelationshipDto[] = [
  // Tom Wilson
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.TOM_WILSON.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.TOM_WILSON.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'weekend activity',
    },
  },
  {
    fromNodeId: people.TOM_WILSON.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'craft beer',
    },
  },

  // Jessica Lee
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.JESSICA_LEE.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.JESSICA_LEE.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'relaxation',
    },
  },

  // Chris Martin
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.CHRIS_MARTIN.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.CHRIS_MARTIN.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'weekend rides',
    },
  },
  {
    fromNodeId: people.CHRIS_MARTIN.id,
    toNodeId: concepts.FITNESS.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'lifestyle',
    },
  },

  // Mark Thompson
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.MARK_THOMPSON.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.MARK_THOMPSON.id,
    toNodeId: concepts.BEER.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'brewing',
    },
  },
  {
    fromNodeId: people.MARK_THOMPSON.id,
    toNodeId: concepts.BBQ.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'grilling',
    },
  },

  // Laura Garcia
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.LAURA_GARCIA.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.LAURA_GARCIA.id,
    toNodeId: concepts.READING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'book club',
    },
  },

  // Steve Miller
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.STEVE_MILLER.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.STEVE_MILLER.id,
    toNodeId: concepts.CYCLING.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'group rides',
    },
  },
  {
    fromNodeId: people.STEVE_MILLER.id,
    toNodeId: concepts.TRAVEL.id,
    type: RelationshipType.PREFERS,
    strength: 0.85,
    properties: {
      context: 'vacation',
    },
  },
  {
    fromNodeId: people.STEVE_MILLER.id,
    toNodeId: concepts.WINE.id,
    type: RelationshipType.PREFERS,
    strength: 0.8,
    properties: {
      context: 'tasting',
    },
  },

  // Amanda Brown
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.AMANDA_BROWN.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.AMANDA_BROWN.id,
    toNodeId: concepts.WRITING.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Brian Wilson
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.BRIAN_WILSON.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.BRIAN_WILSON.id,
    toNodeId: concepts.FITNESS.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Karen Davis
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.KAREN_DAVIS.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.KAREN_DAVIS.id,
    toNodeId: concepts.HIKING.id,
    type: RelationshipType.PREFERS,
    strength: 0.95,
    properties: {
      context: 'organizer',
    },
  },
  {
    fromNodeId: people.KAREN_DAVIS.id,
    toNodeId: concepts.PHOTOGRAPHY.id,
    type: RelationshipType.INTERESTED_IN,
    strength: 1.0,
  },

  // Paul Anderson
  {
    fromNodeId: people.JOHN_SMITH.id,
    toNodeId: people.PAUL_ANDERSON.id,
    type: RelationshipType.FRIENDS_WITH,
    strength: 0.8,
  },
  {
    fromNodeId: people.PAUL_ANDERSON.id,
    toNodeId: concepts.COFFEE.id,
    type: RelationshipType.PREFERS,
    strength: 0.9,
    properties: {
      context: 'daily',
    },
  },
];

export const RELATIONSHIPS: CreateRelationshipDto[] = [
  ...SMITH_FAMILY_RELATIONSHIPS,
  ...JOHN_PREFERS,
  ...SARAH_PREFERS,
  ...EMMA_PREFERS,
  ...LUCAS_PREFERS,
  ...JOHN_DISLIKES,
  ...SARAH_DISLIKES,
  ...EMMA_DISLIKES,
  ...LUCAS_DISLIKES,
  ...COWORKER_RELATIONSHIPS,
  ...FRIEND_RELATIONSHIPS,
];
