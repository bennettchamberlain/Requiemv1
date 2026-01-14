import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const ASSOCIATE_RELATIONS: SeedRelationship[] = [
  {
    fromNodeId: people.KAREN_DAVIS.id,
    toNodeId: people.CALEB_DAVIS.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.AMANDA_BROWN.id,
    toNodeId: people.TYLER_BROWN.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.MAYA_PATEL.id,
    toNodeId: people.LIAM_PATEL.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.JESSICA_LEE.id,
    toNodeId: people.SOPHIA_LEE.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-daughter',
    },
  },
  {
    fromNodeId: people.REBECCA_LEWIS.id,
    toNodeId: people.CHLOE_LEWIS.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-daughter',
    },
  },
  {
    fromNodeId: people.RACHEL_BENNETT.id,
    toNodeId: people.LEO_RICCI.id,
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },

  // Child -> Parent (Inverse)
  {
    fromNodeId: people.CALEB_DAVIS.id,
    toNodeId: people.KAREN_DAVIS.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.TYLER_BROWN.id,
    toNodeId: people.AMANDA_BROWN.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.LIAM_PATEL.id,
    toNodeId: people.MAYA_PATEL.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.SOPHIA_LEE.id,
    toNodeId: people.JESSICA_LEE.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'daughter-mother',
    },
  },
  {
    fromNodeId: people.CHLOE_LEWIS.id,
    toNodeId: people.REBECCA_LEWIS.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'daughter-mother',
    },
  },
  {
    fromNodeId: people.LEO_RICCI.id,
    toNodeId: people.RACHEL_BENNETT.id,
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
];
