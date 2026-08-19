import type { DocumentNode } from 'graphql';

import { gql } from '@/graphql';

/**
 * Shape every `delete*` mutation in this family returns, and the variables they
 * all take (`DeleteByIdInput`). Declared once so the dialog can run whichever
 * document the open entity needs without a per-type branch.
 */
export interface DeletePayload {
  success: boolean;
  deletedId?: string | null;
}

export type DeleteMutationData = Record<string, DeletePayload | null>;

export interface DeleteMutationVariables {
  input: { id: string };
}

const DELETE_EVENT = gql(`
  mutation DeleteMemoryEvent($input: DeleteByIdInput!) {
    deleteEvent(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_CONTENT = gql(`
  mutation DeleteMemoryContent($input: DeleteByIdInput!) {
    deleteContent(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_PLACE = gql(`
  mutation DeleteMemoryPlace($input: DeleteByIdInput!) {
    deletePlace(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_PERSON = gql(`
  mutation DeleteMemoryPerson($input: DeleteByIdInput!) {
    deletePerson(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_ITEM = gql(`
  mutation DeleteMemoryItem($input: DeleteByIdInput!) {
    deleteItem(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_CONCEPT = gql(`
  mutation DeleteMemoryConcept($input: DeleteByIdInput!) {
    deleteConcept(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_NOTE = gql(`
  mutation DeleteMemoryNote($input: DeleteByIdInput!) {
    deleteNote(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_COMMUNICATION = gql(`
  mutation DeleteMemoryCommunication($input: DeleteByIdInput!) {
    deleteCommunication(input: $input) {
      success
      deletedId
    }
  }
`);

const DELETE_BROWSER_ACTIVITY = gql(`
  mutation DeleteMemoryBrowserActivity($input: DeleteByIdInput!) {
    deleteBrowserActivity(input: $input) {
      success
      deletedId
    }
  }
`);

/** Undo for the one type that is tombstoned rather than destroyed. */
export const RESTORE_EVENT = gql(`
  mutation RestoreMemoryEvent($input: RestoreByIdInput!) {
    restoreEvent(input: $input) {
      id
    }
  }
`);

export interface DeleteTarget {
  /** Mutation to run; every one of them takes `DeleteByIdInput`. */
  document: DocumentNode;
  /** Response key carrying the payload (`data.deleteEvent`, …). */
  field: string;
  /** What the user is removing, as it reads mid-sentence. */
  noun: string;
  /**
   * Whether the delete is reversible. Only events are tombstoned
   * (`ci.events.is_deleted`); everything else is destroyed outright, and the
   * confirmation copy has to say so.
   */
  recoverable: boolean;
}

/**
 * Deletable memory objects, keyed by the resource type encoded in their global
 * id (which is also what a graph node's entity type normalises to) rather than
 * by `__typename`, so search results and graph nodes resolve through one table.
 *
 * Types absent here have no delete mutation on the server and therefore get no
 * affordance: files, answers, threads, file chunks.
 */
export const DELETE_TARGETS: Record<string, DeleteTarget> = {
  event: { document: DELETE_EVENT, field: 'deleteEvent', noun: 'event', recoverable: true },
  content: { document: DELETE_CONTENT, field: 'deleteContent', noun: 'content', recoverable: false },
  place: { document: DELETE_PLACE, field: 'deletePlace', noun: 'place', recoverable: false },
  person: { document: DELETE_PERSON, field: 'deletePerson', noun: 'person', recoverable: false },
  item: { document: DELETE_ITEM, field: 'deleteItem', noun: 'thing', recoverable: false },
  concept: { document: DELETE_CONCEPT, field: 'deleteConcept', noun: 'concept', recoverable: false },
  note: { document: DELETE_NOTE, field: 'deleteNote', noun: 'note', recoverable: false },
  communication: {
    document: DELETE_COMMUNICATION,
    field: 'deleteCommunication',
    noun: 'message',
    recoverable: false,
  },
  'browser-activity': {
    document: DELETE_BROWSER_ACTIVITY,
    field: 'deleteBrowserActivity',
    noun: 'browsing record',
    recoverable: false,
  },
};
