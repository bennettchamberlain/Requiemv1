import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { ASK_INBOX, ASK_OUTBOX, MY_ASK_GRANTS } from './asksOperations';
import { AsksPage } from './AsksPage';

vi.mock('@ci/common', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ci/common');

  return { ...actual, usePageTitle: () => {} };
});

const inboxAsk = {
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
};

const mocks = [
  { request: { query: ASK_INBOX }, result: { data: { askInbox: [inboxAsk] } } },
  { request: { query: ASK_OUTBOX }, result: { data: { askOutbox: [] } } },
  { request: { query: MY_ASK_GRANTS }, result: { data: { myAskGrants: [] } } },
];

function renderPage() {
  // The shared helper supplies every provider the app shell expects (router,
  // auth, features, Apollo) — rendering the page bare fails with the
  // deliberately unhelpful "undefined must be used within the associated
  // Provider".
  return renderWithProviders(<AsksPage />, { mocks, route: '/asks' });
}

describe('AsksPage', () => {
  it('renders a pending ask from the inbox', async () => {
    renderPage();

    // AskReviewCard wraps the prompt in typographic quotes, so match on the
    // words rather than pinning the punctuation.
    expect(await screen.findByText(/Lake trip photos\?/)).toBeInTheDocument();
    // The count rides in the tab label so a waiting queue is visible without
    // opening the tab.
    expect(screen.getByText('For you (1)')).toBeInTheDocument();
  });

  it('does not invent a trust tier or a display name', async () => {
    renderPage();
    await screen.findByText(/Lake trip photos\?/);

    // The mock's five-tier vocabulary must never appear from a wire that
    // carries no tier — asserting an unearned trust level is the exact defect
    // this binding exists to avoid.
    for (const tier of ['household', 'family', 'trusted', 'stranger']) {
      expect(screen.queryByText(tier)).toBeNull();
    }

    // No grant matched, so the honest label is shown and the asker is opaque.
    expect(screen.getByText('no standing grant')).toBeInTheDocument();
    expect(screen.getByText(/Peer abc123/)).toBeInTheDocument();
  });

  it('shows the structured scope, which is all that is on the wire', async () => {
    renderPage();

    await waitFor(() => expect(screen.getByText(/photos · photos/)).toBeInTheDocument());
  });
});
