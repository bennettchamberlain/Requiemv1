import '../styles.css';

import type { FragmentType } from '@/graphql';

import type { BROWSER_ACTIVITY_FRAGMENT } from '../EntityCard/BrowserActivityCard.tsx';
import type { COMMUNICATION_FRAGMENT } from '../EntityCard/CommunicationCard.tsx';
import type { EVENT_FRAGMENT } from '../EntityCard/EventCard.tsx';

import { BrowserActivityDetails } from './BrowserActivityDetails.tsx';
import { CommunicationDetails } from './CommunicationDetails';
import { EventDetails } from './EventDetails';

export interface Props {
  entity: FragmentType<
    typeof BROWSER_ACTIVITY_FRAGMENT | typeof COMMUNICATION_FRAGMENT | typeof EVENT_FRAGMENT
  >;
}

function getCategoryComponent({ entity }: Props) {
  switch (entity.__typename) {
    case 'BrowserActivityType':
      return <BrowserActivityDetails entity={entity} />;
    case 'CommunicationType':
      return <CommunicationDetails entity={entity} />;
    case 'EventType':
      return <EventDetails entity={entity} />;
    default:
      return null;
  }
}

export function EntityDetails({ entity }: Props) {
  return getCategoryComponent({ entity });
}
