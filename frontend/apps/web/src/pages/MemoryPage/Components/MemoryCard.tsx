import { FileText, Package, User, Contact, Lightbulb, Target, Video, File, Radio } from '@ci/shadcn/icons';

import { EventCard, CommunicationCard, GenericCard, PlaceCard } from './blocks';
import type { MemoryCardProps } from './types';

export function MemoryCard({ memory }: MemoryCardProps) {
  // Check for specific entity types to use specialized icons
  const entityType = memory.metadata?.entityType as string | undefined;

  switch (memory.type) {
    case 'event':
      return <EventCard memory={memory} />;
    case 'communication':
      return <CommunicationCard memory={memory} />;
    case 'content':
      // Use specific icons for different content entity types
      if (entityType === 'Video') {
        return <GenericCard memory={memory} Icon={Video} iconColor="text-red-600" />;
      }

      if (entityType === 'File') {
        return <GenericCard memory={memory} Icon={File} iconColor="text-blue-600" />;
      }

      if (entityType === 'Document') {
        return <GenericCard memory={memory} Icon={FileText} iconColor="text-green-600" />;
      }

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
      // Use specific icon for Channel entity type
      if (entityType === 'Channel') {
        return <GenericCard memory={memory} Icon={Radio} iconColor="text-purple-600" />;
      }

      return <GenericCard memory={memory} Icon={Target} iconColor="text-gray-600" />;
    default:
      return <GenericCard memory={memory} Icon={Target} iconColor="text-gray-600" />;
  }
}

export type { MemoryItem } from './types';
