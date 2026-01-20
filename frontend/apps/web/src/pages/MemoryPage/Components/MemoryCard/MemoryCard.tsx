import { BrowserActivityCard } from './BrowserActivityCard';
import { CommunicationCard } from './CommunicationCard';
import { EventCard } from './EventCard';
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
    default:
      return null;
  }
}
