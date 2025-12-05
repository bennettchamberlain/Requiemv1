import { useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';

import { InventoryItemModal } from '@/components/modals/InventoryItemModal';
import { useAuth } from '@/hooks';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  brand: string;
  model: string;
  currentValue: number;
  images: string[];
}

export default function InventoryPage() {
  const [{ authToken }] = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  const fetchItems = async () => {
    try {
      const data = await fetchJson<InventoryItem[]>('/api/memory/items', {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });
      setItems(data);
    } catch (error) {
      console.error('Failed to fetch inventory', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authToken) {
      fetchItems();
    }
  }, [authToken]);

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading inventory...</div>;
  }

  return (
    <div className="container mx-auto p-4 md:p-8">
      <h1 className="text-2xl font-bold mb-6">My Inventory</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {items.map((item) => (
          <div
            key={item.id}
            className="border rounded-lg overflow-hidden bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col"
            onClick={() => setSelectedItem(item)}
          >
            <div className="aspect-square bg-stone-100 dark:bg-zinc-800 relative overflow-hidden">
              {item.images && item.images.length > 0 ? (
                <img
                  src={`/static${item.images[0].split('?')[0]}`}
                  alt={item.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">No Image</div>
              )}
            </div>
            <div className="p-4 flex flex-col flex-1">
              <h3 className="font-bold text-lg truncate" title={item.name}>
                {item.name}
              </h3>
              <p className="text-sm text-gray-500 mb-2">{item.category}</p>
              <div className="mt-auto flex justify-between items-center text-sm">
                <span className="font-medium">${item.currentValue}</span>
                <span className="text-gray-400 truncate max-w-[50%]">{item.brand}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <p>No items in your inventory yet.</p>
          <p className="text-sm mt-2">Use the capture button to add items.</p>
        </div>
      )}

      <InventoryItemModal
        open={!!selectedItem}
        onClose={() => setSelectedItem(null)}
        item={selectedItem}
        onUpdate={fetchItems}
      />
    </div>
  );
}
