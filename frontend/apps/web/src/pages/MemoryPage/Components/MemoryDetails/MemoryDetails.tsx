import { SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@ci/shadcn/src/components/ui/sheet';
import '../styles.css';

import type { MemoryItem } from '../../types';

import { CommunicationDetails } from './CommunicationDetails';
import { ConceptDetails } from './ConceptDetails';
import { ContactDetails } from './ContactDetails';
import { ContentDetails } from './ContentDetails';
import { EventDetails } from './EventDetails';
import { LocationDetails } from './LocationDetails';
import { OtherDetails } from './OtherDetails';
import { PersonDetails } from './PersonDetails';
import { PlaceDetails } from './PlaceDetails';
import { ThingDetails } from './ThingDetails';

export interface Props {
  memory: MemoryItem;
}

function getCategoryComponent({ memory }: Props) {
  switch (memory.category) {
    case 'Communication':
      return <CommunicationDetails memory={memory} />;
    case 'Concept':
      return <ConceptDetails memory={memory} />;
    case 'Contact':
      return <ContactDetails memory={memory} />;
    case 'Content':
      return <ContentDetails memory={memory} />;
    case 'Event':
      return <EventDetails memory={memory} />;
    case 'File':
      return <ContentDetails memory={memory} />;
    case 'Location':
      return <LocationDetails memory={memory} />;
    case 'Other':
      return <OtherDetails memory={memory} />;
    case 'Person':
      return <PersonDetails memory={memory} />;
    case 'Place':
      return <PlaceDetails memory={memory} />;
    case 'Thing':
      return <ThingDetails memory={memory} />;
    default:
      return null;
  }
}

export function MemoryDetails({ memory }: Props) {
  return (
    <SheetContent className="z-index-1000">
      <SheetHeader>
        <SheetTitle>{memory.title}</SheetTitle>
        <SheetDescription>{memory.description}</SheetDescription>
      </SheetHeader>
      {getCategoryComponent({ memory })}
    </SheetContent>
  );
}
