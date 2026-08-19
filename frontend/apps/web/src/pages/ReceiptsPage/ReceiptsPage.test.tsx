import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GetReceiptsQuery, ReceiptExtractionState } from '@/graphql/graphql';
import { mockQuery } from '@/test/gql';
import { renderWithProviders } from '@/test/renderWithProviders';

import { GET_RECEIPTS, PAGE_SIZE, ReceiptsPage } from './ReceiptsPage';

// The hub nav reads a provider the harness deliberately does not supply (see
// renderWithProviders); ThingsPage.test.tsx stubs it the same way.
vi.mock('@/components/MemoryHub', () => ({
  MemoryHubShell: ({ children }: { children: React.ReactNode }) => children,
}));

const navigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();

  return { ...actual, useNavigate: () => navigate };
});

type ReceiptNode = GetReceiptsQuery['receipts']['edges'][number]['node'];

const RECEIPT_ID = btoa('receipt:r1');

const BASE_VARIABLES: {
  merchantName: string | null;
  extractionState: ReceiptExtractionState | null;
  first: number;
} = {
  merchantName: null,
  extractionState: null,
  first: PAGE_SIZE,
};

const makeReceipt = (overrides: Partial<ReceiptNode> = {}): ReceiptNode =>
  ({
    __typename: 'ReceiptType' as const,
    id: RECEIPT_ID,
    merchantName: 'Hornbach',
    purchasedAt: '2026-05-01T00:00:00.000Z',
    totalMinor: 12999,
    currency: 'EUR',
    orderNumber: 'A-77',
    channel: 'IN_STORE' as const,
    extractionState: 'EXTRACTED' as const,
    lineItems: [{ __typename: 'ReceiptLineItemType' as const, id: 'l1' }],
    ...overrides,
  }) as ReceiptNode;

const receiptsResult = (nodes: ReceiptNode[], totalCount = nodes.length) => ({
  receipts: {
    __typename: 'ReceiptConnection' as const,
    totalCount,
    pageInfo: { __typename: 'PageInfo' as const, hasNextPage: false, endCursor: null },
    edges: nodes.map((node) => ({ __typename: 'ReceiptEdge' as const, cursor: node.id, node })),
  },
});

const receiptsMock = (variables: Partial<typeof BASE_VARIABLES>, nodes: ReceiptNode[], totalCount?: number) =>
  mockQuery(GET_RECEIPTS, { ...BASE_VARIABLES, ...variables }, receiptsResult(nodes, totalCount), {
    maxUsageCount: 3,
  });

describe('ReceiptsPage', () => {
  it('renders each receipt with its total in ITS OWN currency, not dollars', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [receiptsMock({}, [makeReceipt()], 7)],
    });

    expect(await screen.findByText('Hornbach')).toBeInTheDocument();
    expect(screen.getByText('7 receipts')).toBeInTheDocument();

    const total = screen.getByText(/129[.,]99/);

    expect(total).toHaveTextContent('€');
    expect(total).not.toHaveTextContent('$');
  });

  it('counts a single line as "1 line" and several as "lines"', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [
        receiptsMock({}, [
          makeReceipt(),
          makeReceipt({
            id: btoa('receipt:r2'),
            merchantName: 'Bauhaus',
            lineItems: [
              { __typename: 'ReceiptLineItemType', id: 'l1' },
              { __typename: 'ReceiptLineItemType', id: 'l2' },
            ],
          } as Partial<ReceiptNode>),
        ]),
      ],
    });

    expect(await screen.findByText('1 line')).toBeInTheDocument();
    expect(screen.getByText('2 lines')).toBeInTheDocument();
  });

  it('flags a receipt whose extraction never finished, and leaves a finished one unflagged', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [
        receiptsMock({}, [
          makeReceipt(),
          makeReceipt({
            id: btoa('receipt:r2'),
            merchantName: 'Bauhaus',
            extractionState: 'NOT_APPLICABLE',
          } as Partial<ReceiptNode>),
        ]),
      ],
    });

    // Humanized, not the raw `NOT_APPLICABLE`.
    expect(await screen.findByText('Not applicable')).toBeInTheDocument();
    expect(screen.queryByText('Extracted')).toBeNull();
  });

  it('shows an em dash rather than a bare 0 when a receipt has no total', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [receiptsMock({}, [makeReceipt({ totalMinor: null } as Partial<ReceiptNode>)])],
    });

    expect(await screen.findByText('—')).toBeInTheDocument();
  });

  it('sends the merchant filter to the server rather than filtering on the client', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [
        receiptsMock({}, [makeReceipt()]),
        // Trimmed, and null-not-empty-string is covered by BASE_VARIABLES.
        receiptsMock({ merchantName: 'bauhaus' }, [
          makeReceipt({ id: btoa('receipt:r2'), merchantName: 'Bauhaus' } as Partial<ReceiptNode>),
        ]),
      ],
    });

    fireEvent.change(await screen.findByPlaceholderText('Search by merchant...'), {
      target: { value: '  bauhaus  ' },
    });

    expect(await screen.findByText('Bauhaus')).toBeInTheDocument();
  });

  it('sends the extraction-state filter as the enum the resolver takes', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [
        receiptsMock({}, [makeReceipt()]),
        receiptsMock({ extractionState: 'FAILED' }, [
          makeReceipt({
            id: btoa('receipt:r3'),
            merchantName: 'Toom',
            extractionState: 'FAILED',
          } as Partial<ReceiptNode>),
        ]),
      ],
    });

    fireEvent.click(await screen.findByLabelText('Extraction state'));
    fireEvent.click(await screen.findByRole('option', { name: 'Failed' }));

    expect(await screen.findByText('Toom')).toBeInTheDocument();
  });

  it('opens a receipt at its decoded id', async () => {
    navigate.mockClear();

    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [receiptsMock({}, [makeReceipt()])],
    });

    fireEvent.click(await screen.findByText('Hornbach'));

    expect(navigate).toHaveBeenCalledWith('/receipts/r1');
  });

  it('shows an empty state instead of an empty list', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [receiptsMock({}, [], 0)],
    });

    expect(await screen.findByText('No receipts found')).toBeInTheDocument();
  });

  it('reports a failed load with the server message', async () => {
    renderWithProviders(<ReceiptsPage />, {
      route: '/memory/receipts',
      mocks: [mockQuery(GET_RECEIPTS, BASE_VARIABLES, { error: new Error('receipts unavailable') })],
    });

    expect(await screen.findByText(/Couldn't load receipts: receipts unavailable/)).toBeInTheDocument();
  });
});
