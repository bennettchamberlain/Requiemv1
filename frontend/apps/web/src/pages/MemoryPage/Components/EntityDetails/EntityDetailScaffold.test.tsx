import { Sheet } from '@ci/shadcn';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/renderWithProviders';

import type { EntityItem } from '../../useEntityService';

import { EntityDrawerHostProvider } from './drawerHost';
import { FallbackDetails } from './FallbackDetails';

vi.mock('@/components/ChatWithAgent', () => ({
  ChatWithAgentMenu: () => null,
}));

vi.mock('@/components/EntityRelationshipCards/EntityRelationshipCards', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/EntityRelationshipCards/EntityRelationshipCards')>();

  return { ...actual, EntityRelationshipCards: () => null };
});

const host = { setActiveEntity: vi.fn(), refetch: vi.fn() };

describe('EntityDetailScaffold', () => {
  it('pads the sheet into the iPhone safe area so the header and close control stay on-screen', async () => {
    renderWithProviders(
      <EntityDrawerHostProvider value={host}>
        <Sheet open>
          <FallbackDetails
            entity={
              {
                __typename: 'ThreadType',
                id: 'thread-0',
                name: 'Project Planning Assistant',
                description: 'Helping outline the phases.',
                tags: [],
              } as EntityItem
            }
          />
        </Sheet>
      </EntityDrawerHostProvider>,
    );

    const sheet = await screen.findByTestId('entity-detail-sheet');

    expect(sheet).toHaveClass('pt-[var(--safe-area-top)]');
    expect(sheet).toHaveClass('pb-[var(--safe-area-bottom)]');
    expect(sheet).toHaveClass('[&>button]:top-[calc(var(--safe-area-top)+1rem)]');
    expect(await screen.findByRole('heading', { name: 'Project Planning Assistant' })).toBeInTheDocument();
  });
});
