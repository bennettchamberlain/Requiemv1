import * as people from '../people';

import { RelationshipType, type SeedRelationship } from './types';

export const ASSOCIATE_RELATIONS: SeedRelationship[] = [
  {
    fromNodeId: people.KAREN_DAVIS.id,
    fromNodeType: 'entity',
    toNodeId: people.CALEB_DAVIS.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.AMANDA_BROWN.id,
    fromNodeType: 'entity',
    toNodeId: people.TYLER_BROWN.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.MAYA_PATEL.id,
    fromNodeType: 'entity',
    toNodeId: people.LIAM_PATEL.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },
  {
    fromNodeId: people.JESSICA_LEE.id,
    fromNodeType: 'entity',
    toNodeId: people.SOPHIA_LEE.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-daughter',
    },
  },
  {
    fromNodeId: people.REBECCA_LEWIS.id,
    fromNodeType: 'entity',
    toNodeId: people.CHLOE_LEWIS.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-daughter',
    },
  },
  {
    fromNodeId: people.RACHEL_BENNETT.id,
    fromNodeType: 'entity',
    toNodeId: people.LEO_RICCI.id,
    toNodeType: 'entity',
    type: RelationshipType.PARENT_OF,
    strength: 1.0,
    properties: {
      relationship: 'mother-son',
    },
  },

  // Child -> Parent (Inverse)
  {
    fromNodeId: people.CALEB_DAVIS.id,
    fromNodeType: 'entity',
    toNodeId: people.KAREN_DAVIS.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.TYLER_BROWN.id,
    fromNodeType: 'entity',
    toNodeId: people.AMANDA_BROWN.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.LIAM_PATEL.id,
    fromNodeType: 'entity',
    toNodeId: people.MAYA_PATEL.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
  {
    fromNodeId: people.SOPHIA_LEE.id,
    fromNodeType: 'entity',
    toNodeId: people.JESSICA_LEE.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'daughter-mother',
    },
  },
  {
    fromNodeId: people.CHLOE_LEWIS.id,
    fromNodeType: 'entity',
    toNodeId: people.REBECCA_LEWIS.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'daughter-mother',
    },
  },
  {
    fromNodeId: people.LEO_RICCI.id,
    fromNodeType: 'entity',
    toNodeId: people.RACHEL_BENNETT.id,
    toNodeType: 'entity',
    type: RelationshipType.CHILD_OF,
    strength: 1.0,
    properties: {
      relationship: 'son-mother',
    },
  },
];
