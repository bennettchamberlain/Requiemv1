import { useEffect, useState } from 'react';

import { Dialog, Input, Label, Textarea } from '@ci/shadcn';

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  description: string;
  brand: string;
  model: string;
  currentValue: number;
  file: {
    url: string;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
}

export function InventoryItemModal({ open, onClose, item }: Props) {
  const [formData, setFormData] = useState<Partial<InventoryItem>>({});

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name,
        category: item.category,
        description: item.description,
        brand: item.brand,
        model: item.model,
        currentValue: item.currentValue,
      });
    }
  }, [item]);

  if (!item) {
    return null;
  }

  const imageUrl = item.file?.url ? `/static${item.file.url}` : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <Dialog.Content className="sm:max-w-[800px] p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-[80vh] md:h-[600px]">
          {/* Image Section */}
          <div className="w-full md:w-1/2 bg-stone-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt={item.name} className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-400">No image available</div>
            )}
          </div>

          {/* Form Section */}
          <div className="w-full md:w-1/2 p-6 flex flex-col gap-4 overflow-y-auto">
            <Dialog.Header>
              <Dialog.Title>Item details</Dialog.Title>
            </Dialog.Header>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={formData.name || ''} readOnly />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Input id="category" value={formData.category || ''} readOnly />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description || ''}
                  className="min-h-[100px]"
                  readOnly
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="brand">Brand</Label>
                  <Input id="brand" value={formData.brand || ''} readOnly />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="model">Model</Label>
                  <Input id="model" value={formData.model || ''} readOnly />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="value">Estimated Value ($)</Label>
                <Input id="value" type="number" value={formData.currentValue || 0} readOnly />
              </div>
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
