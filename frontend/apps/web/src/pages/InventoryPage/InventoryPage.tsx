import { useState } from 'react';

import { useQuery, gql } from '@apollo/client';
import { usePageTitle } from '@ci/common';

import { PageContent } from '@/components/layout';
import { MemoryHubShell } from '@/components/MemoryHub';
import { InventoryItemModal, type InventoryItem } from '@/components/modals/InventoryItemModal';
import { type UnitSystem, formatDimensions, formatMass, formatTerm } from '@/lib/measurements';

const GET_INVENTORY_ITEMS = gql`
  query GetInventoryItems {
    items {
      edges {
        node {
          id
          name
          category
          description
          brand
          model
          currentValue
          purchasePrice
          condition
          quantity
          acquiredAt
          acquisitionMethod
          acquiredFrom
          manufacturedAt
          expiresAt
          lengthMm
          widthMm
          heightMm
          massG
          volumeMl
          unitSystem
          colors
          colorHex
          materials
          file {
            sourceUrl
          }
        }
      }
    }
  }
`;

/**
 * The one physical line a card has room for: size first, then weight, then what
 * it is made of. Any of the three may be unknown, and an item with none of them
 * shows nothing rather than a row of dashes.
 */
function physicalSummary(item: InventoryItem, system: UnitSystem): string | null {
  const parts = [
    formatDimensions(item, system),
    formatMass(item.massG, system),
    item.materials?.slice(0, 2).map(formatTerm).join(', ') ?? null,
  ].filter((part): part is string => part != null && part !== '');

  return parts.length > 0 ? parts.join(' · ') : null;
}

export function InventoryPage() {
  usePageTitle('Things - Companion Intelligence');

  const { data, loading } = useQuery(GET_INVENTORY_ITEMS, {
    fetchPolicy: 'cache-and-network',
  });

  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const items: InventoryItem[] = data?.items?.edges?.map((edge: { node: InventoryItem }) => edge.node) || [];

  return (
    <>
      <PageContent className="gap-4 p-0">
        <MemoryHubShell>
          <div className="flex flex-col gap-4 px-4 pb-4">
            <h1 className="text-2xl font-bold">Things</h1>

            {loading && items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading things…</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                  {items.map((item) => {
                    const system: UnitSystem = item.unitSystem === 'IMPERIAL' ? 'imperial' : 'metric';
                    const summary = physicalSummary(item, system);

                    return (
                      <div
                        key={item.id}
                        className="border rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col"
                        onClick={() => setSelectedItem(item)}
                      >
                        <div className="aspect-square bg-stone-100 dark:bg-zinc-800 relative overflow-hidden">
                          {item.file?.sourceUrl ? (
                            <img
                              src={`/static${item.file.sourceUrl}`}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="flex items-center justify-center h-full text-gray-400">
                              No Image
                            </div>
                          )}
                          {(item.quantity ?? 1) > 1 && (
                            <span className="absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
                              ×{item.quantity}
                            </span>
                          )}
                        </div>
                        <div className="p-4 flex flex-col flex-1">
                          <div className="flex items-center gap-2">
                            {item.colorHex && (
                              // The swatch is the fastest way to recognise a thing
                              // you own; the colour name is in the title attribute
                              // for anyone who cannot see it.
                              <span
                                className="h-3 w-3 shrink-0 rounded-full border"
                                style={{ backgroundColor: item.colorHex }}
                                title={item.colors?.map(formatTerm).join(', ') ?? item.colorHex}
                              />
                            )}
                            <h3 className="font-bold text-lg truncate" title={item.name}>
                              {item.name}
                            </h3>
                          </div>
                          <p className="text-sm text-gray-500">{item.category}</p>
                          {summary && (
                            <p className="mt-1 text-xs text-gray-400 truncate" title={summary}>
                              {summary}
                            </p>
                          )}
                          <div className="mt-auto pt-2 flex justify-between items-center text-sm">
                            <span className="font-medium">
                              {item.currentValue == null ? '' : `$${item.currentValue}`}
                            </span>
                            <span className="text-gray-400 truncate max-w-[50%]">{item.brand}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {items.length === 0 && (
                  <div className="text-center py-12 text-gray-500">
                    <p>No things tracked yet.</p>
                    <p className="text-sm mt-2">Use the capture button to add items.</p>
                  </div>
                )}

                <InventoryItemModal
                  open={!!selectedItem}
                  onClose={() => setSelectedItem(null)}
                  item={selectedItem}
                  create={false}
                />
              </>
            )}
          </div>
        </MemoryHubShell>
      </PageContent>
    </>
  );
}
