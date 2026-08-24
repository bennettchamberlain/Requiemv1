import type { ComponentType } from 'react';

import { ChartColumn, NotebookPen, User, UserRound } from '@ci/shadcn/icons';

export type SelfSectionIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export type SelfSection = {
  to: string;
  label: string;
  match: (path: string) => boolean;
  flag?: string;
  icon: SelfSectionIcon;
};

/**
 * Self destinations — shared by the in-page tab bar and the Power Rail Self
 * submenu, same reason `MEMORY_HUB_SECTIONS` is shared between `MemoryHubNav`
 * and `MemorySubmenu`: one source of truth so labels, routes, matchers, and
 * flags can't drift between the two renderings.
 */
export const SELF_SECTIONS: SelfSection[] = [
  { to: '/self', label: 'Profile', match: (p) => p === '/self', icon: UserRound },
  { to: '/self/account', label: 'Account', match: (p) => p === '/self/account', icon: User },
  { to: '/self/stats', label: 'Stats', match: (p) => p === '/self/stats', icon: ChartColumn },
  {
    to: '/self/reflections',
    label: 'Reflections',
    match: (p) => p === '/self/reflections',
    flag: 'insights.page',
    icon: NotebookPen,
  },
];

export function isSelfPath(pathname: string): boolean {
  return pathname === '/self' || pathname.startsWith('/self/');
}
