import type { MemoryItem } from '../../types';

import { CommunicationDetails } from './CommunicationDetails';
import { ConceptDetails } from './ConceptDetails';
import { ContactDetails } from './ContactDetails';
import { ContentDetails } from './ContentDetails';
import { EventDetails } from './EventDetails';
import { OtherDetails } from './OtherDetails';
import { PersonDetails } from './PersonDetails';
import { PlaceDetails } from './PlaceDetails';
import { ThingDetails } from './ThingDetails';

export interface Props {
  memory: MemoryItem;
}

export function MemoryDetails({ memory }: Props) {
  switch (memory.type) {
    case 'communication':
      return <CommunicationDetails memory={memory} />;
    case 'concept':
      return <ConceptDetails memory={memory} />;
    case 'contact':
      return <ContactDetails memory={memory} />;
    case 'content':
      return <ContentDetails memory={memory} />;
    case 'event':
      return <EventDetails memory={memory} />;
    case 'other':
      return <OtherDetails memory={memory} />;
    case 'person':
      return <PersonDetails memory={memory} />;
    case 'place':
      return <PlaceDetails memory={memory} />;
    case 'thing':
      return <ThingDetails memory={memory} />;
    default:
      return null;
  }
}
