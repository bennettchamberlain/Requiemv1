import type { MockedResponse } from '@apollo/client/testing';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { APPROVE_ASK, ASK_INBOX, ASK_OUTBOX, MY_ASK_GRANTS, RUN_ASK } from './asksOperations';
import { AsksPage } from './AsksPage';

vi.mock('@ci/common', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ci/common');

  return { ...actual, usePageTitle: () => {} };
});

function askRow(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'AskType',
    id: 'ask-1',
    status: 'delivered',
    createdAt: '2026-08-20T00:00:00.000Z',
    consentBasis: null,
    askerId: 'globaluid-abc123',
    peerHandle: null,
    query: {
      __typename: 'AskQueryType',
      queryType: 'photos',
      dataClass: 'photos',
      prompt: 'Lake trip photos?',
    },
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'AskGrantType',
    id: 'grant-1',
    mode: 'auto',
    queryType: 'photos',
    dataClass: 'photos',
    purpose: null,
    granteeId: 'globaluid-sam001',
    granteePeerLinkId: null,
    revokedAt: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Repeat a mock so a post-mutation refetch has something to land on. */
function repeated(mock: MockedResponse, times = 3): MockedResponse[] {
  return Array.from({ length: times }, () => mock);
}

const inboxOk = (asks: unknown[]) => ({
  request: { query: ASK_INBOX },
  result: { data: { askInbox: asks } },
});
const outboxOk = { request: { query: ASK_OUTBOX }, result: { data: { askOutbox: [] } } };
const grantsOk = (grants: unknown[]) => ({
  request: { query: MY_ASK_GRANTS },
  result: { data: { myAskGrants: grants } },
});

function renderPage(mocks: readonly MockedResponse[]) {
  // The shared helper supplies every provider the app shell expects (router,
  // auth, features, Apollo) — rendering the page bare fails with the
  // deliberately unhelpful "undefined must be used within the associated
  // Provider".
  return renderWithProviders(<AsksPage />, { mocks, route: '/asks' });
}

const defaultMocks = [...repeated(inboxOk([askRow()])), outboxOk, ...repeated(grantsOk([]))];

describe('AsksPage', () => {
  it('renders a pending ask from the inbox', async () => {
    renderPage(defaultMocks);

    // AskReviewCard wraps the prompt in typographic quotes, so match on the
    // words rather than pinning the punctuation.
    expect(await screen.findByText(/Lake trip photos\?/)).toBeInTheDocument();
    // The count rides in the tab label so a waiting queue is visible without
    // opening the tab.
    expect(screen.getByText('For you (1)')).toBeInTheDocument();
  });

  it('does not invent a trust tier or a display name', async () => {
    renderPage(defaultMocks);
    await screen.findByText(/Lake trip photos\?/);

    // The mock's five-tier vocabulary must never appear from a wire that
    // carries no tier — asserting an unearned trust level is the exact defect
    // this binding exists to avoid.
    for (const tier of ['household', 'family', 'trusted', 'stranger']) {
      expect(screen.queryByText(tier)).toBeNull();
    }

    // No grant matched, so the honest label is shown and the asker is opaque —
    // and the shortened id reads as a truncation, not as corrupted text.
    expect(screen.getByText('no standing grant')).toBeInTheDocument();
    expect(screen.getByText(/Peer …abc123/)).toBeInTheDocument();
  });

  it('shows the structured scope, which is all that is on the wire', async () => {
    renderPage(defaultMocks);

    await waitFor(() => expect(screen.getByText(/photos · photos/)).toBeInTheDocument());
  });

  it('never lets the declared data class read as a narrower search than runs', async () => {
    // `location` is not in AskExecutorService's hint table, so the executed
    // search is unfiltered across the responder's whole memory.
    renderPage([
      ...repeated(
        inboxOk([
          askRow({
            query: {
              __typename: 'AskQueryType',
              queryType: 'location',
              dataClass: 'location',
              prompt: 'Where do you live?',
            },
          }),
        ]),
      ),
      outboxOk,
      ...repeated(grantsOk([])),
    ]);

    expect(await screen.findByText(/every kind of thing in your memory/i)).toBeInTheDocument();
  });

  it('does not present an already-authorized ask as a consent decision', async () => {
    renderPage([
      ...repeated(inboxOk([askRow({ status: 'delivered', consentBasis: 'grant-1' })])),
      outboxOk,
      ...repeated(grantsOk([])),
    ]);

    expect(await screen.findByText('Already authorized')).toBeInTheDocument();
    // The quarantine warning belongs to asks nothing covers, and to no others.
    expect(screen.queryByText(/No standing grant covers this request/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Answer now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and answer' })).toBeNull();
  });

  it('sends the owner’s disclosure choice on the wire', async () => {
    const runVariables: Record<string, unknown>[] = [];

    renderPage([
      ...repeated(inboxOk([askRow()])),
      outboxOk,
      ...repeated(grantsOk([])),
      {
        request: { query: APPROVE_ASK, variables: { id: 'ask-1' } },
        result: { data: { approveAsk: { __typename: 'AskPayload', success: true } } },
      },
      {
        request: {
          query: RUN_ASK,
          variables: { id: 'ask-1', redactItemIds: [], disclosureForm: 'boolean' },
        },
        result: (variables: Record<string, unknown>) => {
          runVariables.push(variables);

          return {
            data: {
              runAsk: {
                __typename: 'RunAskPayload',
                success: true,
                disclosedCount: 0,
                withheldCount: 0,
              },
            },
          };
        },
      },
    ]);

    await screen.findByText(/Lake trip photos\?/);
    fireEvent.click(screen.getByRole('button', { name: /At most yes or no/i }));

    // The ladder is worthless unless the chosen form reaches runAsk — the whole
    // point is that the owner can cap an answer without declining outright.
    await waitFor(() => expect(runVariables).toHaveLength(1));
    expect(runVariables[0]).toMatchObject({ disclosureForm: 'boolean' });
  });

  it('does not let a failed approval look like one that worked', async () => {
    renderPage([
      ...repeated(inboxOk([askRow()])),
      outboxOk,
      ...repeated(grantsOk([])),
      {
        request: { query: APPROVE_ASK, variables: { id: 'ask-1' } },
        error: new Error('approve rejected'),
      },
    ]);

    await screen.findByText(/Lake trip photos\?/);
    fireEvent.click(screen.getByRole('button', { name: 'Approve and answer' }));

    // The gesture is the owner consenting to a disclosure. A silent failure
    // leaves them believing they answered someone they did not.
    expect(await screen.findByText(/didn.t go through/i)).toBeInTheDocument();
    expect(screen.getByText(/approve rejected/i)).toBeInTheDocument();
  });

  it('does not claim an empty inbox when the request failed', async () => {
    renderPage([
      { request: { query: ASK_INBOX }, error: new Error('network down') },
      outboxOk,
      ...repeated(grantsOk([])),
    ]);

    expect(await screen.findByText(/Couldn.t load your inbox/i)).toBeInTheDocument();
    // "we could not ask" must never render as "nothing is being shared".
    expect(screen.queryByText(/No one is waiting on you/i)).toBeNull();
  });

  it('does not claim there are no standing grants when that request failed', async () => {
    renderPage([
      ...repeated(inboxOk([])),
      outboxOk,
      { request: { query: MY_ASK_GRANTS }, error: new Error('network down') },
    ]);

    await screen.findByText(/No one is waiting on you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Who can ask me what' }));

    expect(await screen.findByText(/Couldn.t load your standing grants/i)).toBeInTheDocument();
    // "Every ask comes to you for review" is a promise about consent. It must
    // never be printed on the strength of a request that never answered.
    expect(screen.queryByText(/No standing grants/i)).toBeNull();
  });

  it('does not claim you have sent nothing when that request failed', async () => {
    renderPage([
      ...repeated(inboxOk([])),
      { request: { query: ASK_OUTBOX }, error: new Error('network down') },
      ...repeated(grantsOk([])),
    ]);

    await screen.findByText(/No one is waiting on you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Sent' }));

    expect(await screen.findByText(/Couldn.t load the asks you have sent/i)).toBeInTheDocument();
    expect(screen.queryByText(/haven't asked anyone anything yet/i)).toBeNull();
  });

  it('does not claim there are no standing grants while that query is in flight', async () => {
    renderPage([
      ...repeated(inboxOk([])),
      outboxOk,
      // Never resolves: the grants tab must stay silent rather than assert an
      // empty consent matrix on the strength of the OTHER queries settling.
      { request: { query: MY_ASK_GRANTS }, delay: 30_000, result: { data: { myAskGrants: [] } } },
    ]);

    await screen.findByText(/No one is waiting on you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Who can ask me what' }));

    expect(screen.queryByText(/No standing grants/i)).toBeNull();
  });

  it('marks the grant mode controls as unavailable instead of faking them', async () => {
    renderPage([...repeated(inboxOk([])), outboxOk, ...repeated(grantsOk([grantRow()]))]);

    await screen.findByText(/No one is waiting on you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Who can ask me what' }));

    // No updateAskGrant document reaches this client, so a live-looking control
    // would tell the owner they had changed consent when they had not.
    expect(await screen.findByRole('button', { name: 'Ask me first' })).toBeDisabled();
    expect(screen.getByText(/Changing a grant’s mode isn’t available yet/i)).toBeInTheDocument();
    // Revoking really does work, so it stays enabled.
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });

  it('never renders a revoked grant as live consent', async () => {
    renderPage([
      ...repeated(inboxOk([])),
      outboxOk,
      ...repeated(grantsOk([grantRow({ revokedAt: '2026-08-03T00:00:00.000Z' })])),
    ]);

    await screen.findByText(/No one is waiting on you/i);
    fireEvent.click(screen.getByRole('button', { name: 'Who can ask me what' }));

    expect(await screen.findByText('Revoked')).toBeInTheDocument();
    expect(screen.getByText(/no longer in force/i)).toBeInTheDocument();
    // An `auto` badge on a withdrawn grant reads as "this still answers".
    expect(screen.queryByText('Auto')).toBeNull();
  });
});
