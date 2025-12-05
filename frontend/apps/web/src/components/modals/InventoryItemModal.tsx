import { useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Dialog, Input, Label, Textarea } from '@ci/shadcn';

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

interface Props {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  onUpdate: () => void;
}

export function InventoryItemModal({ open, onClose, item, onUpdate }: Props) {
  const [{ authToken }] = useAuth();
  const [formData, setFormData] = useState<Partial<InventoryItem>>({});
  const [saving, setSaving] = useState(false);

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

  const handleChange = (field: keyof InventoryItem, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!item) {
      return;
    }

    setSaving(true);
    try {
      await fetchJson(`/api/memory/items/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(formData),
      });
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Failed to update item', error);
    } finally {
      setSaving(false);
    }
  };

  if (!item) {
    return null;
  }

  const imageUrl = item.images && item.images.length > 0 ? `/static${item.images[0].split('?')[0]}` : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <Dialog.Content className="sm:max-w-[800px] p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-[80vh] md:h-[600px]">
          {/* Image Section */}
          <div className="w-full md:w-1/2 bg-stone-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
            {imageUrl ? (
              <img src={imageUrl} alt={item.name} className="w-full h-full object-contain" />
            ) : (
              <div className="text-gray-400">No Image Available</div>
            )}
          </div>

          {/* Form Section */}
          <div className="w-full md:w-1/2 p-6 flex flex-col gap-4 overflow-y-auto">
            <Dialog.Header>
              <Dialog.Title>Edit Item Details</Dialog.Title>
            </Dialog.Header>

            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name || ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  value={formData.category || ''}
                  onChange={(e) => handleChange('category', e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description || ''}
                  onChange={(e) => handleChange('description', e.target.value)}
                  className="min-h-[100px]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="brand">Brand</Label>
                  <Input
                    id="brand"
                    value={formData.brand || ''}
                    onChange={(e) => handleChange('brand', e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="model">Model</Label>
                  <Input
                    id="model"
                    value={formData.model || ''}
                    onChange={(e) => handleChange('model', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="value">Estimated Value ($)</Label>
                <Input
                  id="value"
                  type="number"
                  value={formData.currentValue || 0}
                  onChange={(e) => handleChange('currentValue', parseFloat(e.target.value))}
                />
              </div>
            </div>

            <div className="mt-auto flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </Dialog.Content>
    </Dialog>
  );
}
