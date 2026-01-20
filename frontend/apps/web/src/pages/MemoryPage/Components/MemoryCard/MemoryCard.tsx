import type { MemoryItem } from '../../types';

import { BrowserActivityCard } from './BrowserActivityCard';
import { CommunicationCard } from './CommunicationCard';
import { ConceptCard } from './ConceptCard';
import { ContactCard } from './ContactCard';
import { ContentCard } from './ContentCard';
import { EventCard } from './EventCard';
import { OtherCard } from './OtherCard';
import { PersonCard } from './PersonCard';
import { PlaceCard } from './PlaceCard';
import { ThingCard } from './ThingCard';
import type {FragmentType} from "@/graphql";

export interface Props {
  memory: FragmentType<any>;
}

export function MemoryCard({ memory }: Props) {
  switch (memory.__typename) {
    case 'BrowserActivityType':
      return <BrowserActivityCard memory={memory} />;
    case 'EventType':
      return <EventCard memory={memory} />;
    case 'CommunicationType':
      return <CommunicationCard memory={memory} />;
    case 'other':
      return <OtherCard memory={memory} />;
    default:
      return null;
  }
}
