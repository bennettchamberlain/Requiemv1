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
  /**
   * Rows that belong under this one, as one compact group.
   *
   * The head is still its own destination — the children sit beside it, they
   * do not replace it. A child rides its OWN flag: if the head is gated off,
   * surviving children are promoted back to the top level rather than
   * disappearing with it (see {@link visibleRailDestinations}).
   */
  readonly children?: readonly RailDestination[];
}

export const RAIL_DESTINATIONS: readonly RailDestination[] = [
  { id: 'plan', to: '/plan', label: 'Plan', icon: ListTodo, flag: 'planning.page' },
  { id: 'calendar', to: '/calendar', label: 'Calendar', icon: CalendarRange, badge: 'feed', end: false },
  { id: 'forecast', to: '/forecast', label: 'Forecast', icon: CloudSun, flag: 'forecast.page' },
  { id: 'memory', to: '/memory', label: 'Memory', icon: Brain, match: isMemoryHubPath },
  { id: 'saved-searches', to: '/saved-searches', label: 'Saved Searches', icon: FolderSearch2 },
  // Chat is a group, not a row: asking the Companion something and the Asks it
  // asks back are one conversation surface, and two peer rows for it read as
  // two unrelated places. The pages stay separate — /chat and /asks are still
  // their own routes, on their own flags.
  //
  // `end: false` so a thread deep-link (/chat/:id) still lights up Chat.
  {
    id: 'chat',
    to: '/chat',
    label: 'Chat',
    icon: MessagesSquare,
    flag: 'chat.page',
    end: false,
    children: [
      // `ask`, not `asks.page`: this is the SAME flag the /asks route and every
      // ask resolver check, so the rail row and the page it points at can never
      // disagree. A rail entry gated on a different flag is a link to a 404.
      { id: 'asks', to: '/asks', label: 'Asks', icon: MessageCircleQuestion, flag: 'ask' },
    ],
  },
  { id: 'sources', to: '/sources', label: 'Sources', icon: Cable, end: false },
  { id: 'jobs', to: '/jobs', label: 'Jobs', icon: Workflow, flag: 'jobs.page' },
  // Combines the former About You / Account settings and the Stats page —
  // one destination for "who I am to the system", rendered as the user tile
  // at the foot of the rail rather than in the destination list. Still gated
  // on `stats.page` so no config/env rename is needed.
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

function isVisible(destination: RailDestination, isFeatureEnabled: (flag: string) => boolean): boolean {
  return !destination.flag || isFeatureEnabled(destination.flag);
}

export function visibleRailDestinations(isFeatureEnabled: (flag: string) => boolean): RailDestination[] {
  return RAIL_DESTINATIONS.flatMap((destination) => {
    const children = (destination.children ?? []).filter((child) => isVisible(child, isFeatureEnabled));

    // A group head going dark must not take its children with it. `chat.page`
    // off does not unregister /asks, so Asks climbs back out to the top level
    // and stays reachable instead of becoming a page you can only type at.
    if (!isVisible(destination, isFeatureEnabled)) {
      return children;
    }

    return [{ ...destination, children }];
  });
}

/** Every destination, group heads and their children alike, flat. */
export function allRailDestinations(): RailDestination[] {
  return RAIL_DESTINATIONS.flatMap((destination) => [destination, ...(destination.children ?? [])]);
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
