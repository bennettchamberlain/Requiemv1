import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImportSurface } from './ImportPage';

vi.mock('./wizard/ImportWizard', () => ({ ImportWizard: () => <div>wizard surface</div> }));
vi.mock('./InboxPanel', () => ({ InboxPanel: () => <div>inbox surface</div> }));
vi.mock('./HistoryTab', () => ({ HistoryTab: () => <div>history surface</div> }));

/**
 * One machinery, one navigation row: the wizard's three steps are the default
 * surface (the page exists to walk someone through an import), with the Inbox
 * folder and History one click away on the same row. There is no "Import" tab
 * — the steps are it, and clicking one is the way back.
 */
describe('ImportSurface', () => {
  it('opens on the wizard', () => {
    render(<ImportSurface />);

    expect(screen.getByText('wizard surface')).toBeInTheDocument();
    expect(screen.queryByText('inbox surface')).not.toBeInTheDocument();
    expect(screen.queryByText('history surface')).not.toBeInTheDocument();
  });

  it('switches to the Inbox tab', () => {
    render(<ImportSurface />);

    const inbox = screen.getByRole('tab', { name: /inbox/i });

    fireEvent.mouseDown(inbox, { button: 0 });
    fireEvent.click(inbox);
    expect(screen.getByText('inbox surface')).toBeInTheDocument();
  });

  it('switches to History, and a step button is the way back', () => {
    render(<ImportSurface />);

    // Radix activates a tab from mousedown, not the synthesized click alone.
    const history = screen.getByRole('tab', { name: /history/i });

    fireEvent.mouseDown(history, { button: 0 });
    fireEvent.click(history);
    expect(screen.getByText('history surface')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Pick/ }));
    expect(screen.getByText('wizard surface')).toBeInTheDocument();
  });

  it('offers no Import tab — the steps name that surface already', () => {
    render(<ImportSurface />);

    expect(screen.queryByRole('tab', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Inbox', 'History']);
  });

  it('marks no step current while another surface is showing', () => {
    render(<ImportSurface />);

    expect(screen.getByRole('button', { name: /Pick/ })).toHaveAttribute('aria-current', 'step');

    const inbox = screen.getByRole('tab', { name: /inbox/i });

    fireEvent.mouseDown(inbox, { button: 0 });
    fireEvent.click(inbox);

    // Saying "you are on Pick" while the Inbox is on screen would be a lie.
    expect(screen.getByRole('button', { name: /Pick/ })).not.toHaveAttribute('aria-current');
  });
});
