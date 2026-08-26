import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import { mockSavedSearch } from './_storyHelpers';
import { ShareSavedSearchModal } from './ShareSavedSearchModal';

/**
 * B13: the modal used to render an "Embed" iframe snippet and Facebook/LinkedIn
 * buttons. `/shared/:token` is behind ProtectedRoute (App.tsx) and the session
 * cookie is `sameSite: 'lax'`, so a third-party iframe or a public social post
 * can never resolve for a visitor who isn't already signed in to this
 * appliance — nothing in the modal said so. The embed section and the two
 * public-audience buttons are gone; Email/Message remain because both target
 * one specific person who can be told separately they'll need an account.
 */
describe('ShareSavedSearchModal — no controls that promise a public link', () => {
  it('renders the copyable link and Email/Message, but no Embed section or Facebook/LinkedIn', async () => {
    renderWithProviders(<ShareSavedSearchModal savedSearch={mockSavedSearch()} onClose={() => {}} />);

    expect(await screen.findByText('Share link')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /message/i })).toBeInTheDocument();

    expect(screen.queryByText('Embed')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /facebook/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /linkedin/i })).not.toBeInTheDocument();
  });

  it('tells the recipient this is not a public link', async () => {
    renderWithProviders(<ShareSavedSearchModal savedSearch={mockSavedSearch()} onClose={() => {}} />);

    expect(await screen.findByText(/isn't a public link/i)).toBeInTheDocument();
  });
});
