import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportPage } from './ImportPage';

vi.mock('@ci/common', () => ({ usePageTitle: () => undefined }));
vi.mock('@/components/layout', () => ({
  PageContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./wizard/ImportWizard', () => ({ ImportWizard: () => <div>wizard surface</div> }));
vi.mock('./HistoryTab', () => ({ HistoryTab: () => <div>history surface</div> }));

/**
 * The page is two tabs over one machinery: the wizard is the default (the page
 * exists to walk someone through an import), History one click away.
 */
describe('ImportPage', () => {
  it('opens on the wizard', () => {
    render(<ImportPage />);

    expect(screen.getByText('wizard surface')).toBeInTheDocument();
    expect(screen.queryByText('history surface')).not.toBeInTheDocument();
  });

  it('switches to History and back', () => {
    render(<ImportPage />);

    // Radix activates a tab from mousedown, not the synthesized click alone.
    const history = screen.getByRole('tab', { name: /history/i });

    fireEvent.mouseDown(history, { button: 0 });
    fireEvent.click(history);
    expect(screen.getByText('history surface')).toBeInTheDocument();

    const importTab = screen.getByRole('tab', { name: /import/i });

    fireEvent.mouseDown(importTab, { button: 0 });
    fireEvent.click(importTab);
    expect(screen.getByText('wizard surface')).toBeInTheDocument();
  });
});
