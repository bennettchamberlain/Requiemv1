import type { LucideIcon } from '@ci/shadcn/icons';
import {
  BookOpen,
  Brain,
  Cable,
  CalendarRange,
  CircleUserRound,
  CloudSun,
  FolderSearch2,
  LifeBuoy,
  ListTodo,
  MessageCircleQuestion,
  MessagesSquare,
  Workflow,
} from '@ci/shadcn/icons';

import { useFeatures } from '@/common/feature';
import { isMemoryHubPath } from '@/components/MemoryHub/memoryHubSections';

/**
 * Destinations in the Power Rail, top to bottom (and on the phone, the same
 * list inside the glass overlay drawer).
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
  { id: 'calendar', to: '/calendar', label: 'Calendar', icon: CalendarRange, badge: 'feed', end: false },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: CloudSun, flag: 'forecast.page' },
  { id: 'memory', to: '/memory', label: 'Memory', icon: Brain, match: isMemoryHubPath },
  { id: 'saved-searches', to: '/saved-searches', label: 'Saved Searches', icon: FolderSearch2 },
  { id: 'chat', to: '/chat', label: 'Chat', icon: MessagesSquare, flag: 'chat.page' },
  // `ask`, not `asks.page`: this is the SAME flag the /asks route and every ask
  // resolver check, so the rail row and the page it points at can never
  // disagree. A rail entry gated on a different flag is a link to a 404.
  { id: 'asks', to: '/asks', label: 'Asks', icon: MessageCircleQuestion, flag: 'ask' },
  { id: 'sources', to: '/sources', label: 'Sources', icon: Cable, end: false },
  { id: 'jobs', to: '/jobs', label: 'Jobs', icon: Workflow, flag: 'jobs.page' },
  // Combines the former About You / Account settings and the Stats page —
  // one destination for "who I am to the system". Still gated on `stats.page`
  // (unchanged) so no config/env rename is needed for what was already a
  // purely cosmetic flag name.
  { id: 'self', to: '/self', label: 'Self', icon: CircleUserRound, flag: 'stats.page', end: false },
];

export const HELP_LINKS = [
  { href: 'https://ci.computer/support', label: 'Support', icon: LifeBuoy },
  {
    href: 'https://docs.ci.computer/docs/apps-available/first-party-apps/companion-memory-server',
    label: 'Docs',
    icon: BookOpen,
  },
] as const;

export function visibleRailDestinations(isFeatureEnabled: (flag: string) => boolean): RailDestination[] {
  return RAIL_DESTINATIONS.filter((destination) => !destination.flag || isFeatureEnabled(destination.flag));
}

export function useVisibleRailDestinations(): RailDestination[] {
  const { isFeatureEnabled } = useFeatures();

  return visibleRailDestinations(isFeatureEnabled);
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
