import type { ComponentType } from 'react';

import { ChartColumn, NotebookPen, UserRound } from '@ci/shadcn/icons';

export type SelfSectionIcon = ComponentType<{ className?: string; strokeWidth?: number }>;

export type SelfSection = {
  to: string;
  label: string;
  match: (path: string) => boolean;
  flag?: string;
  icon: SelfSectionIcon;
};

/**
 * Self destinations — the Power Rail Self submenu's sub-items. Account
 * deletion/credentials live at the bottom of Profile rather than as their own
 * destination — one identity surface, not two.
 */
export const SELF_SECTIONS: SelfSection[] = [
  { to: '/self', label: 'Profile', match: (p) => p === '/self', icon: UserRound },
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
