import type { ComponentType } from 'react';

import {
  ContentIcon,
  EventIcon,
  ItemIcon,
  PersonIcon,
  PlaceIcon,
  ReceiptIcon,
  TagIcon,
} from '@/components/icons';

export type MemoryHubIcon = ComponentType<{ className?: string; colorized?: boolean }>;

export type MemoryHubSection = {
  to: string;
  label: string;
  match: (path: string) => boolean;
  flag?: string;
  icon: MemoryHubIcon;
};

/**
 * Memory hub destinations — shared by the in-page hub tabs and the Power Rail
 * Memory submenu so labels, routes, matchers, and flags stay in lockstep.
 */
export const MEMORY_HUB_SECTIONS: MemoryHubSection[] = [
  {
    to: '/memory/events',
    label: 'Events',
    match: (p) => p === '/memory/events',
    icon: EventIcon,
  },
  {
    to: '/memory/people',
    label: 'People',
    match: (p) => p === '/memory/people' || p.startsWith('/people/'),
    icon: PersonIcon,
  },
  {
    to: '/memory/places',
    label: 'Places',
    match: (p) => p === '/memory/places' || p.startsWith('/places/'),
    icon: PlaceIcon,
  },
  {
    to: '/memory/things',
    label: 'Things',
    // `/items/:id` is the Thing detail page, so it has to keep this tab lit —
    // the old matcher only covered the retired `/inventory` alias.
    match: (p) => p === '/memory/things' || p.startsWith('/inventory') || p.startsWith('/items/'),
    icon: ItemIcon,
  },
  {
    to: '/memory/receipts',
    label: 'Receipts',
    match: (p) => p === '/memory/receipts' || p.startsWith('/receipts'),
    icon: ReceiptIcon,
  },
  {
    to: '/memory/content',
    label: 'Content',
    // `/memory/content/:fileId` opens a file viewer on this same page, so it
    // has to keep the Content tab lit rather than dropping the whole hub nav.
    match: (p) => p === '/memory/content' || p.startsWith('/memory/content/'),
    flag: 'files.page',
    icon: ContentIcon,
  },
  {
    to: '/memory/tags',
    label: 'Tags',
    match: (p) => p === '/memory/tags',
    flag: 'tags.page',
    icon: TagIcon,
  },
];

export function isMemoryHubPath(pathname: string): boolean {
  if (pathname === '/memory' || pathname.startsWith('/memory/')) {
    return true;
  }

  // Legacy detail routes that still live outside /memory/*.
  return MEMORY_HUB_SECTIONS.some((section) => section.match(pathname));
}

export function isMemoryExplorerPath(pathname: string): boolean {
  return pathname === '/memory/events' || pathname === '/memory';
}
