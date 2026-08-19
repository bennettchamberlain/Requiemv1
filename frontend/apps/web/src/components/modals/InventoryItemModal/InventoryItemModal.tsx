import { type ReactNode, useEffect, useState } from 'react';

import { useMutation, type Reference, isReference } from '@apollo/client';
import { Button, Dialog, Input, Label, Select, Textarea, cn } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { gql } from '@/graphql';
import type { ItemAcquisitionMethod, ItemCondition, ItemUnitSystem } from '@/graphql/graphql';
import {
  UNIT_LABELS,
  type UnitSystem,
  lengthFromMm,
  lengthToMm,
  massFromG,
  massToG,
  volumeFromMl,
  volumeToMl,
} from '@/lib/measurements';
import { GET_ITEM } from '@/pages/ItemPage/ItemPage';

export interface InventoryItem {
  id: string;
  name: string;
  category?: string | null;
  description?: string | null;
  brand?: string | null;
  model?: string | null;
  currentValue?: number | null;
  purchasePrice?: number | null;
  condition?: string | null;
  quantity?: number | null;
  acquiredAt?: string | null;
  acquisitionMethod?: string | null;
  acquiredFrom?: string | null;
  manufacturedAt?: string | null;
  expiresAt?: string | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  massG?: number | null;
  volumeMl?: number | null;
  unitSystem?: string | null;
  colors?: string[] | null;
  colorHex?: string | null;
  materials?: string[] | null;
  file?: {
    sourceUrl: string;
  } | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  item: InventoryItem | null;
  create: boolean;
  detailPagePath?: string;
}

/**
 * Every field the form writes, held as the STRING the input actually contains.
 *
 * Measurements are the reason: they are entered in whatever unit the user
 * picked and stored in millimetres/grams/millilitres, so keeping the typed text
 * as the state means switching units re-renders the same numbers rather than
 * re-rounding them on every keystroke. The conversion happens exactly twice —
 * on load and on submit.
 */
interface ItemForm {
  name: string;
  category: string;
  description: string;
  brand: string;
  model: string;
  currentValue: string;
  purchasePrice: string;
  /** '' is "unspecified"; the rest are the schema's own enum values. */
  condition: ItemCondition | '';
  quantity: string;
  unitSystem: UnitSystem;
  length: string;
  width: string;
  height: string;
  mass: string;
  volume: string;
  colors: string;
  colorHex: string;
  materials: string;
  acquiredAt: string;
  acquisitionMethod: ItemAcquisitionMethod | '';
  acquiredFrom: string;
  manufacturedAt: string;
  expiresAt: string;
}

const EMPTY_FORM: ItemForm = {
  name: '',
  category: '',
  description: '',
  brand: '',
  model: '',
  currentValue: '',
  purchasePrice: '',
  condition: '',
  quantity: '',
  unitSystem: 'metric',
  length: '',
  width: '',
  height: '',
  mass: '',
  volume: '',
  colors: '',
  colorHex: '',
  materials: '',
  acquiredAt: '',
  acquisitionMethod: '',
  acquiredFrom: '',
  manufacturedAt: '',
  expiresAt: '',
};

// Listed rather than derived: `enumsAsTypes` leaves no runtime object to
// iterate, and this is also the order the menu shows.
const CONDITIONS = [
  'NEW',
  'LIKE_NEW',
  'GOOD',
  'FAIR',
  'POOR',
  'BROKEN',
  'NA',
] as const satisfies readonly ItemCondition[];

const CONDITION_LABELS: Record<ItemCondition, string> = {
  NEW: 'New',
  LIKE_NEW: 'Like new',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  BROKEN: 'Broken',
  NA: 'Not applicable',
};

const ACQUISITION_METHODS = [
  'PURCHASED',
  'GIFT',
  'INHERITED',
  'FOUND',
  'MADE',
  'BORROWED',
  'TRADED',
  'SAMPLE',
  'UNKNOWN',
] as const satisfies readonly ItemAcquisitionMethod[];

const ACQUISITION_LABELS: Record<ItemAcquisitionMethod, string> = {
  PURCHASED: 'Purchased',
  GIFT: 'Gift',
  INHERITED: 'Inherited',
  FOUND: 'Found',
  MADE: 'Made it',
  BORROWED: 'Borrowed',
  TRADED: 'Traded',
  SAMPLE: 'Sample / freebie',
  UNKNOWN: 'Unknown',
};

/** The sentinel a Select uses for "no choice", since Radix forbids an empty value. */
const UNSET = '__unset__';

/** Exported so tests can assert on the exact variables the form sends. */
export const CREATE_INVENTORY_ITEM = gql(`
  mutation CreateItem($input: CreateItemInput!) {
    createItem(input: $input) {
      item {
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
        composition
        tags {
          id
          label
        }
      }
      success
    }
  }
`);

export const UPDATE_INVENTORY_ITEM = gql(`
  mutation UpdateItem($input: UpdateItemInput!) {
    updateItem(input: $input) {
      item {
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
        composition
        tags {
          id
          label
        }
      }
      success
    }
  }
`);

/** '' for an unset number, so the input stays empty instead of showing a fake 0. */
function toInput(value: number | null | undefined): string {
  return value == null ? '' : String(value);
}

/** The `YYYY-MM-DD` a date input needs, from whatever the API returned. */
function toDateInput(value: string | null | undefined): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

/** A blank field means "no value", never 0 — the server rejects 0 measurements. */
function toNumber(value: string): number | null {
  const trimmed = value.trim();

  if (trimmed === '') {
    return null;
  }

  const parsed = Number(trimmed);

  return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value: string): string | null {
  return value.trim() === '' ? null : new Date(value).toISOString();
}

/** Comma-separated text → the term array the API takes; empty means "none recorded". */
function toTerms(value: string): string[] | null {
  const terms = value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term !== '');

  return terms.length > 0 ? terms : null;
}

function fromForm(item: InventoryItem): ItemForm {
  const system: UnitSystem = item.unitSystem === 'IMPERIAL' ? 'imperial' : 'metric';

  return {
    ...EMPTY_FORM,
    name: item.name ?? '',
    category: item.category ?? '',
    description: item.description ?? '',
    brand: item.brand ?? '',
    model: item.model ?? '',
    currentValue: toInput(item.currentValue),
    purchasePrice: toInput(item.purchasePrice),
    condition: (item.condition as ItemCondition | null) ?? '',
    quantity: toInput(item.quantity),
    unitSystem: system,
    length: toInput(lengthFromMm(item.lengthMm, system)),
    width: toInput(lengthFromMm(item.widthMm, system)),
    height: toInput(lengthFromMm(item.heightMm, system)),
    mass: toInput(massFromG(item.massG, system)),
    volume: toInput(volumeFromMl(item.volumeMl, system)),
    colors: item.colors?.join(', ') ?? '',
    colorHex: item.colorHex ?? '',
    materials: item.materials?.join(', ') ?? '',
    acquiredAt: toDateInput(item.acquiredAt),
    acquisitionMethod: (item.acquisitionMethod as ItemAcquisitionMethod | null) ?? '',
    acquiredFrom: item.acquiredFrom ?? '',
    manufacturedAt: toDateInput(item.manufacturedAt),
    expiresAt: toDateInput(item.expiresAt),
  };
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t pt-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function InventoryItemModal({ open, onClose, item, create = false, detailPagePath }: Props) {
  const [formData, setFormData] = useState<ItemForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setFormData(item ? fromForm(item) : EMPTY_FORM);
  }, [item]);

  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) =>
    setFormData((previous) => ({ ...previous, [key]: value }));

  const units = UNIT_LABELS[formData.unitSystem];

  /**
   * The measurements the mutation carries, converted from the unit the user was
   * typing in. `unitSystem` rides along so reopening the form shows the numbers
   * back in the same units — it changes nothing about what is stored.
   */
  const measurements = () => ({
    unitSystem: (formData.unitSystem === 'imperial' ? 'IMPERIAL' : 'METRIC') as ItemUnitSystem,
    lengthMm: lengthToMm(toNumber(formData.length), formData.unitSystem),
    widthMm: lengthToMm(toNumber(formData.width), formData.unitSystem),
    heightMm: lengthToMm(toNumber(formData.height), formData.unitSystem),
    massG: massToG(toNumber(formData.mass), formData.unitSystem),
    volumeMl: volumeToMl(toNumber(formData.volume), formData.unitSystem),
  });

  const commonInput = () => ({
    name: formData.name.trim(),
    category: formData.category.trim() || null,
    description: formData.description.trim() || null,
    brand: formData.brand.trim() || null,
    model: formData.model.trim() || null,
    currentValue: toNumber(formData.currentValue),
    purchasePrice: toNumber(formData.purchasePrice),
    condition: formData.condition || null,
    acquiredAt: toDate(formData.acquiredAt),
    acquisitionMethod: formData.acquisitionMethod || null,
    acquiredFrom: formData.acquiredFrom.trim() || null,
    manufacturedAt: toDate(formData.manufacturedAt),
    expiresAt: toDate(formData.expiresAt),
    colors: toTerms(formData.colors),
    colorHex: formData.colorHex.trim() || null,
    materials: toTerms(formData.materials),
    ...measurements(),
  });

  const handleSubmit = async () => {
    setError(null);

    try {
      if (create) {
        await createItem({
          variables: {
            input: {
              ...commonInput(),
              quantity: toNumber(formData.quantity),
            },
          },
        });
      } else {
        await updateItem({
          variables: {
            input: {
              id: item!.id,
              ...commonInput(),
            },
          },
        });
      }

      setFormData(EMPTY_FORM);
      onClose();
    } catch (submitError) {
      // The server rejects impossible things — a zero measurement, an unknown
      // unit, a composition over 100%. Those messages name the field, so they
      // are worth showing verbatim rather than replacing with "Save failed".
      setError(submitError instanceof Error ? submitError.message : 'Could not save this item');
    }
  };

  const [createItem] = useMutation(CREATE_INVENTORY_ITEM, {
    update(cache, { data }) {
      if (data?.createItem && data.createItem.success && data.createItem.item) {
        cache.writeQuery({
          query: GET_ITEM,
          variables: {
            id: data.createItem.item.id,
          },
          data: {
            item: data.createItem.item,
          },
        });

        cache.modify({
          fields: {
            items(existingItems = { edges: [] }) {
              const newItemRef = cache.writeFragment({
                data: data.createItem.item,
                fragment: gql(`
                  fragment NewItem on ItemType {
                    id
                    name
                    category
                    description
                    brand
                    model
                    currentValue
                    condition
                    quantity
                    acquiredAt
                    lengthMm
                    widthMm
                    heightMm
                    massG
                    volumeMl
                    unitSystem
                    colors
                    colorHex
                    materials
                    composition
                  }
                `),
              });

              return {
                ...existingItems,
                edges: [{ node: newItemRef }, ...existingItems.edges],
              };
            },
          },
        });
      }
    },
  });

  const [updateItem] = useMutation(UPDATE_INVENTORY_ITEM, {
    update(cache, { data }) {
      const updatedItemId = data?.updateItem?.item?.id;

      if (updatedItemId) {
        cache.modify({
          fields: {
            items(
              existingItems:
                | {
                    edges: { node: Reference }[];
                  }
                | Reference = { edges: [] },
              { readField },
            ) {
              if (isReference(existingItems)) {
                return existingItems;
              }

              return {
                ...existingItems,
                edges: existingItems.edges.map((edge) => {
                  const edgeNodeId = readField('id', edge.node);

                  if (!data?.updateItem?.item) {
                    return edge;
                  }

                  return edgeNodeId !== updatedItemId
                    ? edge
                    : {
                        ...edge,
                        ...data.updateItem.item,
                      };
                }),
              };
            },
          },
        });
      }
    },
  });

  const imageUrl = item?.file?.sourceUrl ? `/static${item.file.sourceUrl}` : null;
  const showDetailLink = !create && Boolean(detailPagePath);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <Dialog.Content className="sm:max-w-[900px] overflow-hidden">
        <div className="flex flex-col md:flex-row h-[80vh] md:h-[640px]">
          {/* Image Section */}
          {!create && (
            <div className="w-full md:w-2/5 bg-stone-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
              {imageUrl ? (
                <img src={imageUrl} alt={item!.name} className="w-full h-full object-contain" />
              ) : (
                <div className="text-gray-400">No image available</div>
              )}
            </div>
          )}

          {/* Form Section */}
          <div className={cn('w-full p-6 flex flex-col gap-4 overflow-y-auto', !create && 'md:w-3/5')}>
            <Dialog.Header>
              <Dialog.Title>{create ? 'Create item' : 'Item details'}</Dialog.Title>
            </Dialog.Header>

            <div className="grid gap-4 py-2">
              <Field label="Name" htmlFor="name">
                <Input id="name" value={formData.name} onChange={(e) => set('name', e.target.value)} />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Category" htmlFor="category">
                  <Input
                    id="category"
                    value={formData.category}
                    onChange={(e) => set('category', e.target.value)}
                  />
                </Field>
                <Field label="Condition">
                  <Select
                    value={formData.condition || UNSET}
                    onValueChange={(value) =>
                      set('condition', value === UNSET ? '' : (value as ItemCondition))
                    }
                  >
                    <Select.Trigger id="condition">
                      <Select.Value placeholder="Unspecified" />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value={UNSET}>Unspecified</Select.Item>
                      {CONDITIONS.map((condition) => (
                        <Select.Item key={condition} value={condition}>
                          {CONDITION_LABELS[condition]}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Field>
              </div>

              <Field label="Description" htmlFor="description">
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => set('description', e.target.value)}
                  className="min-h-[80px]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Brand" htmlFor="brand">
                  <Input id="brand" value={formData.brand} onChange={(e) => set('brand', e.target.value)} />
                </Field>
                <Field label="Model" htmlFor="model">
                  <Input id="model" value={formData.model} onChange={(e) => set('model', e.target.value)} />
                </Field>
              </div>

              <Section title="Physical">
                <Field label="Units">
                  <Select
                    value={formData.unitSystem}
                    onValueChange={(value) => set('unitSystem', value as UnitSystem)}
                  >
                    <Select.Trigger id="unitSystem" className="w-[220px]">
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content>
                      <Select.Item value="metric">Metric (cm, kg, L)</Select.Item>
                      <Select.Item value="imperial">Imperial (in, lb, fl oz)</Select.Item>
                    </Select.Content>
                  </Select>
                </Field>

                <div className="grid grid-cols-3 gap-4">
                  <Field label={`Length (${units.length})`} htmlFor="length">
                    <Input
                      id="length"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.length}
                      onChange={(e) => set('length', e.target.value)}
                    />
                  </Field>
                  <Field label={`Width (${units.length})`} htmlFor="width">
                    <Input
                      id="width"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.width}
                      onChange={(e) => set('width', e.target.value)}
                    />
                  </Field>
                  <Field label={`Height (${units.length})`} htmlFor="height">
                    <Input
                      id="height"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.height}
                      onChange={(e) => set('height', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <Field label={`Weight (${units.mass})`} htmlFor="mass">
                    <Input
                      id="mass"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.mass}
                      onChange={(e) => set('mass', e.target.value)}
                    />
                  </Field>
                  <Field label={`Capacity (${units.volume})`} htmlFor="volume">
                    <Input
                      id="volume"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.volume}
                      onChange={(e) => set('volume', e.target.value)}
                    />
                  </Field>
                  <Field label="Quantity" htmlFor="quantity">
                    <Input
                      id="quantity"
                      type="number"
                      min="1"
                      step="1"
                      disabled={!create}
                      value={formData.quantity}
                      onChange={(e) => set('quantity', e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Colours" htmlFor="colors">
                    <Input
                      id="colors"
                      placeholder="navy, off white"
                      value={formData.colors}
                      onChange={(e) => set('colors', e.target.value)}
                    />
                  </Field>
                  <Field label="Swatch" htmlFor="colorHex">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label="Pick the dominant colour"
                        type="color"
                        className="h-9 w-10 shrink-0 cursor-pointer rounded border bg-transparent p-1"
                        value={/^#[0-9a-fA-F]{6}$/.test(formData.colorHex) ? formData.colorHex : '#888888'}
                        onChange={(e) => set('colorHex', e.target.value)}
                      />
                      <Input
                        id="colorHex"
                        placeholder="#4a6fa5"
                        value={formData.colorHex}
                        onChange={(e) => set('colorHex', e.target.value)}
                      />
                    </div>
                  </Field>
                </div>

                <Field label="Made of" htmlFor="materials">
                  <Input
                    id="materials"
                    placeholder="leather, brass"
                    value={formData.materials}
                    onChange={(e) => set('materials', e.target.value)}
                  />
                </Field>
              </Section>

              <Section title="Ownership">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Acquired" htmlFor="acquiredAt">
                    <Input
                      id="acquiredAt"
                      type="date"
                      value={formData.acquiredAt}
                      onChange={(e) => set('acquiredAt', e.target.value)}
                    />
                  </Field>
                  <Field label="How">
                    <Select
                      value={formData.acquisitionMethod || UNSET}
                      onValueChange={(value) =>
                        set('acquisitionMethod', value === UNSET ? '' : (value as ItemAcquisitionMethod))
                      }
                    >
                      <Select.Trigger id="acquisitionMethod">
                        <Select.Value placeholder="Unspecified" />
                      </Select.Trigger>
                      <Select.Content>
                        <Select.Item value={UNSET}>Unspecified</Select.Item>
                        {ACQUISITION_METHODS.map((method) => (
                          <Select.Item key={method} value={method}>
                            {ACQUISITION_LABELS[method]}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select>
                  </Field>
                </div>

                <Field label="From" htmlFor="acquiredFrom">
                  <Input
                    id="acquiredFrom"
                    placeholder="Shop, seller or person"
                    value={formData.acquiredFrom}
                    onChange={(e) => set('acquiredFrom', e.target.value)}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Paid ($)" htmlFor="purchasePrice">
                    <Input
                      id="purchasePrice"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.purchasePrice}
                      onChange={(e) => set('purchasePrice', e.target.value)}
                    />
                  </Field>
                  <Field label="Estimated Value ($)" htmlFor="value">
                    <Input
                      id="value"
                      type="number"
                      min="0"
                      step="any"
                      value={formData.currentValue}
                      onChange={(e) => set('currentValue', e.target.value)}
                    />
                  </Field>
                </div>
              </Section>

              <Section title="Lifetime">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Made" htmlFor="manufacturedAt">
                    <Input
                      id="manufacturedAt"
                      type="date"
                      value={formData.manufacturedAt}
                      onChange={(e) => set('manufacturedAt', e.target.value)}
                    />
                  </Field>
                  <Field label="Expires" htmlFor="expiresAt">
                    <Input
                      id="expiresAt"
                      type="date"
                      value={formData.expiresAt}
                      onChange={(e) => set('expiresAt', e.target.value)}
                    />
                  </Field>
                </div>
              </Section>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </div>
        </div>
        <Dialog.Footer className="flex gap-2 justify-end">
          {showDetailLink && (
            <Button asChild type="button" variant="outline">
              <Link to={detailPagePath!}>View details</Link>
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setFormData(EMPTY_FORM);
              setError(null);
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="bg-green-600 hover:bg-green-700"
            disabled={formData.name.trim() === ''}
            onClick={handleSubmit}
          >
            {create ? 'Add' : 'Update'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
