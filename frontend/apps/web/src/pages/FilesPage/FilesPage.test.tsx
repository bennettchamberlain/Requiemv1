import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gql } from '@/graphql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { FilesPage, PAGE_SIZE } from './FilesPage';

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/components/MemoryHub', () => ({
  MemoryHubShell: ({ children }: { children: React.ReactNode }) => children,
}));

const GET_FILES = gql(`
  query GetFiles($first: Int, $after: String) {
    files(first: $first, after: $after) {
      totalCount
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          ...FileGridItemFragment
        }
      }
    }
  }
`);

/**
 * `/memory/content/:fileId` carries the RAW uuid — FilesPage re-encodes it with
 * `GlobalUID.encode('file', id)` before the viewer queries. GraphQL `id` fields
 * are global ids (base64 `file:<uuid>`), so routing with one unchanged would
 * double-encode it and the viewer would find nothing.
 */
const FILE_UUID = '019fd7c0-641c-76dd-8ed7-a5053faff6f1';
const FILE_GLOBAL_ID = btoa(`file:${FILE_UUID}`);
const SECOND_UUID = '019fd7c0-641c-76dd-8ed7-a5053faff6f2';
const SECOND_GLOBAL_ID = btoa(`file:${SECOND_UUID}`);

function pageInfo({ hasNextPage = false, endCursor = null as string | null } = {}) {
  return { __typename: 'PageInfo' as const, hasNextPage, endCursor };
}

function fileNode(overrides: Record<string, unknown> = {}) {
  return {
    __typename: 'FileType' as const,
    id: FILE_GLOBAL_ID,
    filename: 'holiday.jpg',
    previewUrl: null,
    ...overrides,
  };
}

/** See PeoplePage.test.tsx — the suite stubs IntersectionObserver with a no-op. */
function captureIntersectionObserver() {
  const callbacks: IntersectionObserverCallback[] = [];
  const original = globalThis.IntersectionObserver;

  class CapturingObserver {
    constructor(callback: IntersectionObserverCallback) {
      callbacks.push(callback);
    }

    observe() {}

    unobserve() {}

    disconnect() {}

    takeRecords() {
      return [];
    }
  }

  globalThis.IntersectionObserver = CapturingObserver as unknown as typeof IntersectionObserver;

  return {
    scrollSentinelIntoView: async () => {
      await act(async () => {
        for (const callback of callbacks) {
          callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
        }
      });
    },
    restore: () => {
      globalThis.IntersectionObserver = original;
    },
  };
}

function firstPage({ hasNextPage = false, totalCount = 1 } = {}) {
  return {
    request: { query: GET_FILES, variables: { first: PAGE_SIZE } },
    result: {
      data: {
        files: {
          __typename: 'FileConnection' as const,
          totalCount,
          pageInfo: pageInfo({ hasNextPage, endCursor: hasNextPage ? FILE_GLOBAL_ID : null }),
          edges: [{ __typename: 'FileEdge' as const, cursor: FILE_GLOBAL_ID, node: fileNode() }],
        },
      },
    },
  };
}

describe('FilesPage', () => {
  /**
   * Regression: the grid asked for `first: 50` and selected no pageInfo, so on a
   * 14,194-file library it rendered 0.35% of the collection with no "load more",
   * no total, and no hint that anything was missing.
   */
  it('reports how much of the library is on screen', async () => {
    renderWithProviders(<FilesPage />, { mocks: [firstPage({ hasNextPage: true, totalCount: 14194 })] });

    expect(await screen.findByLabelText('holiday.jpg')).toBeInTheDocument();
    expect(screen.getByText(/loaded/).textContent).toContain('1 of 14194 loaded');
  });

  it('appends the next page when the sentinel scrolls into view', async () => {
    const observer = captureIntersectionObserver();

    try {
      renderWithProviders(<FilesPage />, {
        mocks: [
          firstPage({ hasNextPage: true, totalCount: 2 }),
          {
            request: { query: GET_FILES, variables: { first: PAGE_SIZE, after: FILE_GLOBAL_ID } },
            result: {
              data: {
                files: {
                  __typename: 'FileConnection' as const,
                  totalCount: 2,
                  pageInfo: pageInfo(),
                  edges: [
                    {
                      __typename: 'FileEdge' as const,
                      cursor: SECOND_GLOBAL_ID,
                      node: fileNode({ id: SECOND_GLOBAL_ID, filename: 'receipt.pdf' }),
                    },
                  ],
                },
              },
            },
          },
        ],
      });

      expect(await screen.findByLabelText('holiday.jpg')).toBeInTheDocument();
      expect(screen.queryByLabelText('receipt.pdf')).not.toBeInTheDocument();

      await observer.scrollSentinelIntoView();

      // Appended, not swapped in — and the footer now says the list is complete.
      expect(await screen.findByLabelText('receipt.pdf')).toBeInTheDocument();
      expect(screen.getByLabelText('holiday.jpg')).toBeInTheDocument();
      expect(screen.getByText(/loaded/).textContent).toContain('2 of 2 loaded · end');
    } finally {
      observer.restore();
    }
  });

  it('routes to the decoded uuid so an individual file has a shareable URL', async () => {
    navigate.mockClear();
    renderWithProviders(<FilesPage />, { mocks: [firstPage()] });

    fireEvent.click(await screen.findByLabelText('holiday.jpg'));

    expect(navigate).toHaveBeenCalledWith(`/memory/content/${FILE_UUID}`);
    expect(navigate).not.toHaveBeenCalledWith(`/memory/content/${FILE_GLOBAL_ID}`);
  });
});
