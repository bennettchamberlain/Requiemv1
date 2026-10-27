import { ApolloLink, Observable, execute, type FetchResult } from '@apollo/client';
import {
  recordResolvedConnectionMode,
  resetRecordedConnectionMode,
} from '@ci/common/src/utils/connectionMode';
import { OfflineWriteError } from '@ci/common/src/utils/offlineWrites';
import { parse, type DocumentNode } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOfflineWriteLink, isGuardedMutation, isNoteOperationName } from './offlineWriteLink';

// Parsed, not gql-tagged: these are shapes for the guard to classify, not operations the
// app sends, and the GraphQL codegen validates every gql`` in src against the schema.
const DELETE_PERSON = parse(`
  mutation OfflineGuardDeleteMemoryPerson($id: ID!) {
    deleteMemoryPerson(id: $id) {
      success
    }
  }
`);

const UPDATE_NOTE = parse(`
  mutation OfflineGuardUpdateNoteDetail($input: UpdateNoteInput!) {
    updateNote(input: $input) {
      success
    }
  }
`);

const ANONYMOUS_NOTE = parse(`
  mutation {
    deleteNote(input: { id: "x" }) {
      success
    }
  }
`);

const SEARCH = parse(`
  query OfflineGuardSearch($q: String!) {
    search(query: $q) {
      id
    }
  }
`);

function run(link: ApolloLink, query: DocumentNode, operationName?: string): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    execute(link, { query, operationName }).subscribe({ next: resolve, error: reject });
  });
}

afterEach(() => {
  resetRecordedConnectionMode();
});

describe('isNoteOperationName', () => {
  it('matches the note operations and nothing that merely contains the letters', () => {
    for (const name of [
      'CreateNote',
      'UpdateNote',
      'DeleteNote',
      'OfflineGuardUpdateNoteDetail',
      'DeleteMemoryNote',
      'DeleteNotes',
    ]) {
      expect(isNoteOperationName(name)).toBe(true);
    }

    for (const name of ['OfflineGuardDeleteMemoryPerson', 'UpdateNotebook', 'Noteworthy', undefined]) {
      expect(isNoteOperationName(name)).toBe(false);
    }
  });
});

describe('isGuardedMutation', () => {
  it('guards a mutation, exempts notes and queries', () => {
    expect(isGuardedMutation(DELETE_PERSON, 'OfflineGuardDeleteMemoryPerson')).toBe(true);
    expect(isGuardedMutation(UPDATE_NOTE, 'OfflineGuardUpdateNoteDetail')).toBe(false);
    expect(isGuardedMutation(ANONYMOUS_NOTE)).toBe(false);
    expect(isGuardedMutation(SEARCH, 'OfflineGuardSearch')).toBe(false);
  });
});

describe('createOfflineWriteLink', () => {
  function linkWithTerminal() {
    const terminal = vi.fn(() => Observable.of<FetchResult>({ data: { ok: true } }));

    return { link: createOfflineWriteLink().concat(new ApolloLink(terminal)), terminal };
  }

  it('refuses a mutation while the appliance is unreachable, without forwarding it', async () => {
    recordResolvedConnectionMode('local');
    const { link, terminal } = linkWithTerminal();

    await expect(run(link, DELETE_PERSON, 'OfflineGuardDeleteMemoryPerson')).rejects.toBeInstanceOf(
      OfflineWriteError,
    );
    expect(terminal).not.toHaveBeenCalled();
  });

  it('forwards note mutations and queries regardless', async () => {
    recordResolvedConnectionMode('local');
    const { link, terminal } = linkWithTerminal();

    await expect(run(link, UPDATE_NOTE, 'OfflineGuardUpdateNoteDetail')).resolves.toEqual({
      data: { ok: true },
    });
    await expect(run(link, SEARCH, 'OfflineGuardSearch')).resolves.toEqual({ data: { ok: true } });
    expect(terminal).toHaveBeenCalledTimes(2);
  });

  it('forwards every mutation while connected, and before the first probe', async () => {
    const { link, terminal } = linkWithTerminal();

    await run(link, DELETE_PERSON, 'OfflineGuardDeleteMemoryPerson');
    recordResolvedConnectionMode('connected');
    await run(link, DELETE_PERSON, 'OfflineGuardDeleteMemoryPerson');
    expect(terminal).toHaveBeenCalledTimes(2);
  });
});
