import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

vi.mock('../MemoryPage/useEntityService', () => ({
  useEntityService: () => [{ activeEntity: null }, { setActiveEntity: vi.fn() }],
}));

vi.mock('@/components/MemoryHub', () => ({
  MemoryHubShell: ({ children, actions }: { children?: React.ReactNode; actions?: React.ReactNode }) => (
    <div>
      {actions}
      {children}
    </div>
  ),
}));

vi.mock('./Components/ExplorerToolbar/ExplorerToolbar', () => ({
  ExplorerToolbar: () => <div data-testid="explorer-filters" />,
}));

vi.mock('./ListView', () => ({ ListView: () => <div>list</div> }));
vi.mock('./MapView', () => ({ MobileMapView: () => <div>map</div> }));
vi.mock('./StoryTimelineView', () => ({ StoryTimelineView: () => <div>timeline</div> }));
vi.mock('./GalleryView', () => ({ GalleryView: () => <div>gallery</div> }));
vi.mock('./GraphView', () => ({ GraphView: () => <div>graph</div> }));
vi.mock('./Components', () => ({ EntityDetails: () => null }));
vi.mock('@/components/modals/FileChunkModal/FileChunkModal', () => ({ FileChunkModal: () => null }));

import MobileMemoryPage from './MobileMemoryPage';

describe('MobileMemoryPage', () => {
  it('does not render a second search box or a page-level Add — those live in the top bar', () => {
    renderWithProviders(<MobileMemoryPage />, { route: '/memory?view=list' });

    expect(screen.queryByPlaceholderText(/search your memory/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new event/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /list/i })).toBeInTheDocument();
    expect(screen.getByTestId('explorer-filters')).toBeInTheDocument();
  });
});
