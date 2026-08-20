import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { GetItemDuplicatesQuery } from '@/graphql/graphql';
import { mockQuery } from '@/test/gql';
import { renderWithProviders } from '@/test/renderWithProviders';

import {
  GET_ITEM_DUPLICATES,
  GET_THINGS,
  MERGE_ITEMS,
  PAGE_SIZE,
  REJECT_ITEM_DUPLICATES,
  ThingsPage,
} from './ThingsPage';

// The hub nav reads a provider the harness deliberately does not supply (see
// renderWithProviders); PeoplePage.test.tsx stubs it the same way.
vi.mock('@/components/MemoryHub', () => ({
  MemoryHubShell: ({ children }: { children: React.ReactNode }) => children,
}));

// The review tab does its own querying and opens a Radix dialog; it has its own
// surface and is not what these tests are about.
vi.mock('./ObservationReview', () => ({
  ObservationReview: () => <div>observation review</div>,
}));

const THING_A = btoa('item:a');
const THING_B = btoa('item:b');

const BASE_VARIABLES = {
  query: null,
  category: null,
  brand: null,
  condition: null,
  lifecycleState: null,
  hasIdentifier: null,
  sort: 'RECENTLY_SEEN' as const,
  first: PAGE_SIZE,
};

const makeThing = (id: string, name: string) => ({
  __typename: 'ItemType' as const,
  id,
  name,
  description: 'Cordless 18V',
  category: 'tools',
  brand: 'Makita',
  model: 'XPH',
  currentValue: 120,
  quantity: 1,
  lifecycleState: 'ACTIVE' as const,
  lastSeenAt: '2026-05-01T00:00:00.000Z',
  identifiers: [
    {
      __typename: 'ObjectIdentifierType' as const,
      namespace: 'GTIN' as const,
      value: '0012345678905',
      rawValue: '012345678905',
    },
  ],
  product: null,
  file: null,
});

const makeThingsResult = (nodes: ReturnType<typeof makeThing>[], totalCount = nodes.length) => ({
  items: {
    __typename: 'ItemConnection' as const,
    totalCount,
    pageInfo: { __typename: 'PageInfo' as const, hasNextPage: false, endCursor: null },
    edges: nodes.map((node) => ({
      __typename: 'ItemEdge' as const,
      cursor: node.id,
      node,
    })),
  },
});

const NO_DUPLICATES: GetItemDuplicatesQuery = {
  itemDuplicates: {
    __typename: 'ItemDuplicatesPayload' as const,
    totalCount: 0,
    hasMore: false,
    groups: [],
  },
};

const DUPLICATE_GROUP: GetItemDuplicatesQuery = {
  itemDuplicates: {
    __typename: 'ItemDuplicatesPayload' as const,
    totalCount: 1,
    hasMore: false,
    groups: [
      {
        __typename: 'ItemDuplicateGroupType' as const,
        reason: 'IDENTIFIER' as const,
        value: '0012345678905',
        totalItems: 2,
        items: [
          {
            __typename: 'ItemType' as const,
            id: THING_A,
            name: 'Drill',
            brand: 'Makita',
            model: 'XPH',
            category: 'tools',
            quantity: 1,
            lifecycleState: 'ACTIVE' as const,
          },
          {
            __typename: 'ItemType' as const,
            id: THING_B,
            name: 'Makita drill',
            brand: 'Makita',
            model: 'XPH',
            category: 'tools',
            quantity: 1,
            lifecycleState: 'ACTIVE' as const,
          },
        ],
      },
    ],
  },
};

const duplicatesMock = (result: GetItemDuplicatesQuery, maxUsageCount = 3) =>
  mockQuery(GET_ITEM_DUPLICATES, { limit: 20, offset: 0 }, result, { maxUsageCount });

describe('ThingsPage', () => {
  it('renders the search box, the total count and the things themselves', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')], 42), {
          maxUsageCount: 3,
        }),
        duplicatesMock(NO_DUPLICATES),
      ],
    });

    expect(
      await screen.findByPlaceholderText('Search things by name, brand, model or category...'),
    ).toBeInTheDocument();
    expect(await screen.findByText('42 things')).toBeInTheDocument();
    expect(await screen.findByText('Drill')).toBeInTheDocument();
  });

  it('sends the typed query to the server rather than filtering on the client', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 3,
        }),
        mockQuery(
          GET_THINGS,
          { ...BASE_VARIABLES, query: 'lamp' },
          makeThingsResult([makeThing(THING_B, 'Desk lamp')]),
          { maxUsageCount: 3 },
        ),
        duplicatesMock(NO_DUPLICATES),
      ],
    });

    const search = await screen.findByPlaceholderText('Search things by name, brand, model or category...');

    fireEvent.change(search, { target: { value: 'lamp' } });

    expect(await screen.findByText('Desk lamp')).toBeInTheDocument();
  });

  it('sends the code filter as the tri-state Boolean the resolver takes', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 3,
        }),
        // `false` is a real filter (things carrying no code at all), not "off".
        mockQuery(
          GET_THINGS,
          { ...BASE_VARIABLES, hasIdentifier: false },
          makeThingsResult([makeThing(THING_B, 'Uncoded lamp')]),
          { maxUsageCount: 3 },
        ),
        duplicatesMock(NO_DUPLICATES, 5),
      ],
    });

    fireEvent.click(await screen.findByLabelText('Codes'));
    fireEvent.click(await screen.findByRole('option', { name: 'No code' }));

    expect(await screen.findByText('Uncoded lamp')).toBeInTheDocument();
  });

  it('sends hasIdentifier: true for "Has a code"', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 3,
        }),
        mockQuery(
          GET_THINGS,
          { ...BASE_VARIABLES, hasIdentifier: true },
          makeThingsResult([makeThing(THING_B, 'Barcoded drill')]),
          { maxUsageCount: 3 },
        ),
        duplicatesMock(NO_DUPLICATES, 5),
      ],
    });

    fireEvent.click(await screen.findByLabelText('Codes'));
    fireEvent.click(await screen.findByRole('option', { name: 'Has a code' }));

    expect(await screen.findByText('Barcoded drill')).toBeInTheDocument();
  });

  it('shows an empty state instead of an empty grid when nothing matches', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([], 0), { maxUsageCount: 3 }),
        duplicatesMock(NO_DUPLICATES),
      ],
    });

    expect(await screen.findByText('No things found')).toBeInTheDocument();
  });

  it('offers the duplicate group for review, with the shared code that produced it', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 3,
        }),
        duplicatesMock(DUPLICATE_GROUP),
      ],
    });

    expect(await screen.findByText('Possible duplicates')).toBeInTheDocument();
    expect(screen.getByText(/Same code/)).toBeInTheDocument();
    expect(screen.getAllByText('0012345678905').length).toBeGreaterThan(0);
    expect(screen.getByText('Makita drill')).toBeInTheDocument();
  });

  it('merges a duplicate group only after the confirm dialog is accepted', async () => {
    const mergeResult = {
      mergeItems: {
        __typename: 'MergeItemsPayload' as const,
        success: true,
        item: { __typename: 'ItemType' as const, id: THING_A, name: 'Drill' },
        counts: {
          __typename: 'ObjectMergeCountsType' as const,
          identifiers: 1,
          observations: 0,
          receiptLineItems: 0,
        },
      },
    };

    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 5,
        }),
        duplicatesMock(DUPLICATE_GROUP, 5),
        mockQuery(MERGE_ITEMS, { input: { targetId: THING_A, sourceIds: [THING_B] } }, mergeResult),
      ],
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Merge into one thing' }));

    // The dialog is the gate: nothing is written until its Action is clicked.
    const dialog = await screen.findByRole('alertdialog');

    expect(dialog).toHaveTextContent('Merge into one thing?');

    const confirm = within(dialog).getByRole('button', { name: 'Merge into one thing' });

    fireEvent.click(confirm);

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  // The other half of the decision. `itemDuplicates` is recomputed on every
  // request, so a decline that is not written to `ci.entity_merge_blocks` shows
  // the identical group again on the next load — which is exactly what the page
  // did before this mutation existed.
  it('records a declined duplicate group, with no confirm dialog in the way', async () => {
    renderWithProviders(<ThingsPage />, {
      route: '/memory/things',
      mocks: [
        mockQuery(GET_THINGS, BASE_VARIABLES, makeThingsResult([makeThing(THING_A, 'Drill')]), {
          maxUsageCount: 5,
        }),
        duplicatesMock(DUPLICATE_GROUP, 5),
        // The mock matches on VARIABLES, so this is also the assertion that the
        // whole group is sent: a call with anything other than both ids finds no
        // mock, and the card renders the resulting error instead.
        mockQuery(
          REJECT_ITEM_DUPLICATES,
          { itemIds: [THING_A, THING_B] },
          {
            rejectItemDuplicates: true,
          },
        ),
      ],
    });

    const decline = await screen.findByRole('button', { name: 'Not the same thing' });

    fireEvent.click(decline);

    // Declining is not destructive, so unlike the merge it is one click.
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Not the same thing' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Could not record that/)).toBeNull();
  });
});
