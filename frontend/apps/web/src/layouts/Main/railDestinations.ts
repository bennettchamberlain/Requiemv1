import type { LucideIcon } from '@ci/shadcn/icons';
import {
  BookOpen,
  Brain,
  Cable,
  CalendarRange,
  ChartColumn,
  CloudSun,
  FolderSearch2,
  LifeBuoy,
  ListTodo,
  MessagesSquare,
  Workflow,
} from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';
import { isMemoryHubPath } from '@/components/MemoryHub/memoryHubSections';

/**
 * One destination in the Power Rail — and therefore in the mobile tab bar,
 * left to right in this order, with whatever does not fit living under More.
 */
export interface RailDestination {
  readonly id: string;
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly flag?: string;
  /** When false, a child path of `to` still counts as this destination. */
  readonly end?: boolean;
  readonly match?: (pathname: string) => boolean;
  readonly badge?: 'feed';
}

export const RAIL_DESTINATIONS: readonly RailDestination[] = [
  { id: 'plan', to: '/plan', label: 'Plan', icon: ListTodo, flag: 'planning.page' },
  { id: 'today', to: '/today', label: 'Today', icon: CalendarRange, badge: 'feed' },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: CloudSun },
  { id: 'memory', to: '/memory/events', label: 'Memory', icon: Brain, match: isMemoryHubPath },
  { id: 'saved-searches', to: '/saved-searches', label: 'Saved Searches', icon: FolderSearch2 },
  { id: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare, flag: 'chat.page' },
  { id: 'sources', to: '/sources', label: 'Sources', icon: Cable, end: false },
  { id: 'jobs', to: '/jobs', label: 'Jobs', icon: Workflow, flag: 'jobs.page' },
  { id: 'stats', to: '/stats', label: 'Stats', icon: ChartColumn, flag: 'stats.page' },
];

export const HELP_LINKS = [
  { href: 'https://ci.computer/support', label: 'Support', icon: LifeBuoy },
  {
    href: 'https://docs.ci.computer/docs/first-party-apps/digital-memory-server',
    label: 'Docs',
    icon: BookOpen,
  },
] as const;

/** Minimum width of one tab, including More. Phones land around four plus More. */
export const MOBILE_TAB_SLOT_MIN_PX = 64;

/** Used before the bar has a width (SSR, first paint, tests without ResizeObserver). */
export const MOBILE_TAB_FALLBACK_PRIMARY = 4;

export function visibleRailDestinations(isFeatureEnabled: (flag: string) => boolean): RailDestination[] {
  return RAIL_DESTINATIONS.filter((destination) => !destination.flag || isFeatureEnabled(destination.flag));
}

export function useVisibleRailDestinations(): RailDestination[] {
  const { isFeatureEnabled } = useFeatures();

  return visibleRailDestinations(isFeatureEnabled);
}

/**
 * How many rail destinations sit on the bar itself. The last slot is always
 * More — Search, Capture, Help, and System are not in the rail, so they need a
 * home even when every destination already fits.
 */
export function mobilePrimaryTabCount(barWidthPx: number, destinationCount: number): number {
  if (destinationCount <= 0) {
    return 0;
  }

  if (barWidthPx <= 0) {
    return Math.min(destinationCount, MOBILE_TAB_FALLBACK_PRIMARY);
  }

  const slots = Math.max(2, Math.floor(barWidthPx / MOBILE_TAB_SLOT_MIN_PX));

  return Math.min(destinationCount, slots - 1);
}

export function splitMobileDestinations(
  destinations: readonly RailDestination[],
  primaryCount: number,
): { primary: RailDestination[]; overflow: RailDestination[] } {
  const count = Math.max(0, Math.min(primaryCount, destinations.length));

  return {
    primary: destinations.slice(0, count),
    overflow: destinations.slice(count),
  };
}

export function isRailDestinationActive(destination: RailDestination, pathname: string): boolean {
  if (destination.match) {
    return destination.match(pathname);
  }

  if (destination.end === false) {
    return pathname === destination.to || pathname.startsWith(`${destination.to}/`);
  }

  return pathname === destination.to;
}
