import type { ComponentType } from 'react';

import { Tag as TagIcon } from '@ci/shadcn/icons';

import {
  BrowserActivityIcon,
  CommunicationIcon,
  ContentIcon,
  FileIcon,
  ItemIcon,
  NoteIcon,
  PersonIcon,
  PlaceIcon,
} from '@/components/icons';

export type EntityTypeIcon = ComponentType<{ className?: string; colorized?: boolean }>;

export type WhatEntityTypeItem = {
  entityType: string;
  label: string;
  icon?: EntityTypeIcon;
};

export type WhatCategory =
  | {
      kind: 'standalone';
      id: string;
      label: string;
      entityType: string;
      icon: EntityTypeIcon;
    }
  | {
      kind: 'group';
      id: string;
      label: string;
      icon: EntityTypeIcon;
      items: WhatEntityTypeItem[];
    }
  | {
      kind: 'tag';
      id: 'tag';
      label: 'Tag';
      icon: typeof TagIcon;
    };

/** Grouped "What" categories for the Memory explorer nav. */
export const WHAT_CATEGORIES: WhatCategory[] = [
  {
    kind: 'standalone',
    id: 'people',
    label: 'People',
    entityType: 'Person',
    icon: PersonIcon,
  },
  {
    kind: 'standalone',
    id: 'places',
    label: 'Places',
    entityType: 'Place',
    icon: PlaceIcon,
  },
  {
    kind: 'standalone',
    id: 'messages',
    label: 'Messages',
    entityType: 'Communication',
    icon: CommunicationIcon,
  },
  {
    kind: 'group',
    id: 'content',
    label: 'Content',
    icon: ContentIcon,
    items: [
      { entityType: 'Browser', label: 'Browser', icon: BrowserActivityIcon },
      { entityType: 'Content', label: 'Content', icon: ContentIcon },
      { entityType: 'File', label: 'Files', icon: FileIcon },
      { entityType: 'Note', label: 'Notes', icon: NoteIcon },
    ],
  },
  {
    kind: 'standalone',
    id: 'thing',
    label: 'Thing',
    entityType: 'Thing',
    icon: ItemIcon,
  },
  {
    kind: 'tag',
    id: 'tag',
    label: 'Tag',
    icon: TagIcon,
  },
];

export function entityTypesForCategory(category: WhatCategory): string[] {
  if (category.kind === 'standalone') {
    return [category.entityType];
  }

  if (category.kind === 'group') {
    return category.items.map((item) => item.entityType);
  }

  return [];
}
