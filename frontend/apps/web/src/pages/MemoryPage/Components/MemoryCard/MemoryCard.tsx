import { FileText, Package, User, Contact, Lightbulb, Target, Video, File, Radio } from '@ci/shadcn/icons';

import type { MemoryItem } from '../types';

import { CommunicationCard } from './CommunicationCard';
import { EventCard } from './EventCard';
import { GenericCard } from './GenericCard';
import { PlaceCard } from './PlaceCard';

const PRIMARY_ICON_CLASS = 'text-[var(--primary)]';
const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';
const DESTRUCTIVE_ICON_CLASS = 'text-[var(--destructive)]';
const MUTED_ICON_CLASS = 'text-[var(--muted-foreground)]';

export interface Props {
  memory: MemoryItem;
}

export function MemoryCard({ memory }: Props) {
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
        return <GenericCard memory={memory} Icon={Video} iconColorClass={DESTRUCTIVE_ICON_CLASS} />;
      }

      if (entityType === 'File') {
        return <GenericCard memory={memory} Icon={File} iconColorClass={ACCENT_ICON_CLASS} />;
      }

      if (entityType === 'Document') {
        return <GenericCard memory={memory} Icon={FileText} iconColorClass={ACCENT_ICON_CLASS} />;
      }

      return <GenericCard memory={memory} Icon={FileText} iconColorClass={ACCENT_ICON_CLASS} />;
    case 'thing':
      return <GenericCard memory={memory} Icon={Package} iconColorClass={ACCENT_ICON_CLASS} />;
    case 'person':
      return <GenericCard memory={memory} Icon={User} iconColorClass={PRIMARY_ICON_CLASS} />;
    case 'contact':
      return <GenericCard memory={memory} Icon={Contact} iconColorClass={PRIMARY_ICON_CLASS} />;
    case 'place':
      return <PlaceCard memory={memory} />;
    case 'concept':
      return <GenericCard memory={memory} Icon={Lightbulb} iconColorClass={ACCENT_ICON_CLASS} />;
    case 'other':
      // Use specific icon for Channel entity type
      if (entityType === 'Channel') {
        return <GenericCard memory={memory} Icon={Radio} iconColorClass={ACCENT_ICON_CLASS} />;
      }

      return <GenericCard memory={memory} Icon={Target} iconColorClass={MUTED_ICON_CLASS} />;
    default:
      return <GenericCard memory={memory} Icon={Target} iconColorClass={MUTED_ICON_CLASS} />;
  }
}
