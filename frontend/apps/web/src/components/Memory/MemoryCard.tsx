import { FileText, Package, User, Contact, Lightbulb, Target } from '@ci/shadcn/icons';

import { EventCard, CommunicationCard, GenericCard, PlaceCard } from './blocks';
import type { MemoryCardProps } from './types';

export function MemoryCard({ memory }: MemoryCardProps) {
  switch (memory.type) {
    case 'event':
      return <EventCard memory={memory} />;
    case 'communication':
      return <CommunicationCard memory={memory} />;
    case 'content':
      return <GenericCard memory={memory} Icon={FileText} iconColor="text-green-600" />;
    case 'thing':
      return <GenericCard memory={memory} Icon={Package} iconColor="text-purple-600" />;
    case 'person':
      return <GenericCard memory={memory} Icon={User} iconColor="text-blue-600" />;
    case 'contact':
      return <GenericCard memory={memory} Icon={Contact} iconColor="text-indigo-600" />;
    case 'place':
      return <PlaceCard memory={memory} />;
    case 'concept':
      return <GenericCard memory={memory} Icon={Lightbulb} iconColor="text-yellow-600" />;
    case 'other':
      return <GenericCard memory={memory} Icon={Target} iconColor="text-gray-600" />;
    default:
      return <GenericCard memory={memory} Icon={Target} iconColor="text-gray-600" />;
  }
}

export type { MemoryItem } from './types';
