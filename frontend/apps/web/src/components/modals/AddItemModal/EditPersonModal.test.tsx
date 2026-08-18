/**
 * EditPersonModal: loads a person into the shared PersonForm and writes
 * changes back through UpdatePersonProfile. Covers the mutation's three
 * outcomes — success, a rejected write the resolver reports without
 * throwing, and a real network failure — plus the empty-name guard that
 * blocks the request outright.
 */
import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gql } from '@/graphql';
import { mockQuery } from '@/test/gql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { EditPersonModal } from './EditPersonModal';

const GET_PERSON_FOR_EDIT = gql(`
  query GetPersonForEdit($id: ID!) {
    person(id: $id) {
      ...PersonEditorFields
    }
  }
`);

const UPDATE_PERSON = gql(`
  mutation UpdatePersonProfile($input: UpdatePersonInput!) {
    updatePerson(input: $input) {
      success
      person {
        ...PersonEditorFields
      }
    }
  }
`);

const PERSON_ID = 'cGVyc29uOjQy';

function personRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: PERSON_ID,
    name: 'Jamie Rivera',
    description: null,
    firstName: 'Jamie',
    middleName: null,
    lastName: 'Rivera',
    nickname: null,
    pronouns: null,
    gender: null,
    birthDate: null,
    jobTitle: null,
    organization: null,
    department: null,
    website: null,
    avatarUrl: null,
    addresses: [],
    identifiers: [],
    ...overrides,
    // Last, so a loosely-typed override can never widen this off its literal
    // (which the codegen fragment type requires) — overrides never legitimately
    // change the typename anyway.
    __typename: 'PersonType' as const,
  };
}

function getPersonMock(person: ReturnType<typeof personRecord>) {
  return mockQuery(
    GET_PERSON_FOR_EDIT,
    { id: PERSON_ID },
    { person },
    // cache-and-network re-issues the query in the test environment.
    { maxUsageCount: Number.POSITIVE_INFINITY },
  );
}

function updateSuccessMock(
  matchInput: (input: unknown) => boolean,
  person: ReturnType<typeof personRecord>,
): MockedResponse {
  return {
    request: { query: UPDATE_PERSON },
    variableMatcher: (variables: { input: unknown }) => matchInput(variables.input),
    result: { data: { updatePerson: { success: true, person } } },
  } as unknown as MockedResponse;
}

async function renderModal(
  person = personRecord(),
  extraMocks: MockedResponse[] = [],
  props: Partial<React.ComponentProps<typeof EditPersonModal>> = {},
) {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  renderWithProviders(
    <EditPersonModal personId={PERSON_ID} open onClose={onClose} onSaved={onSaved} {...props} />,
    { mocks: [getPersonMock(person), ...extraMocks] },
  );

  // Wait for the form to replace the loading skeleton, rather than an
  // arbitrary tick.
  await screen.findByLabelText('First name');

  return { onSaved, onClose };
}

describe('EditPersonModal — loading and seeding', () => {
  it('shows a skeleton before the person loads', () => {
    renderWithProviders(<EditPersonModal personId={PERSON_ID} open onClose={vi.fn()} />, {
      mocks: [getPersonMock(personRecord())],
    });

    expect(screen.queryByLabelText('First name')).not.toBeInTheDocument();
  });

  it('seeds the form from the loaded person', async () => {
    await renderModal(personRecord({ firstName: 'Jamie', lastName: 'Rivera', jobTitle: 'Engineer' }));

    expect(screen.getByLabelText('Last name')).toHaveValue('Rivera');
    expect(screen.getByLabelText('Job title')).toHaveValue('Engineer');
  });
});

describe('EditPersonModal — validation', () => {
  it('blocks submit with no name anywhere in the draft, and never calls the mutation', async () => {
    // No UPDATE_PERSON mock supplied at all: if the empty-name guard failed to
    // stop the submit, Apollo would have nothing to answer the mutation with
    // and the request would surface as an unhandled error instead of quietly
    // never firing.
    await renderModal(personRecord({ name: '', firstName: '', lastName: '', nickname: '' }));

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Enter a name')).toBeInTheDocument();
    // The dialog is still up on the unsent draft, not closed as if it saved.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });
});

describe('EditPersonModal — saving', () => {
  it('sends the edited fields and closes on a successful save', async () => {
    const { onSaved, onClose } = await renderModal(personRecord(), [
      updateSuccessMock(
        (input) => (input as { jobTitle?: string }).jobTitle === 'Staff Engineer',
        personRecord({ jobTitle: 'Staff Engineer' }),
      ),
    ]);

    fireEvent.change(screen.getByLabelText('Job title'), { target: { value: 'Staff Engineer' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('shows a real error and stays open when the resolver reports a rejected write', async () => {
    const { onSaved, onClose } = await renderModal(personRecord(), [
      {
        request: { query: UPDATE_PERSON },
        variableMatcher: () => true,
        result: { data: { updatePerson: { success: false, person: null } } },
      } as unknown as MockedResponse,
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/update was rejected/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a real error when the request itself fails', async () => {
    const { onSaved, onClose } = await renderModal(personRecord(), [
      {
        request: { query: UPDATE_PERSON },
        variableMatcher: () => true,
        error: new Error('network down'),
      } as unknown as MockedResponse,
    ]);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/network down/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without saving', async () => {
    const { onSaved, onClose } = await renderModal();

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalledWith(false);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
