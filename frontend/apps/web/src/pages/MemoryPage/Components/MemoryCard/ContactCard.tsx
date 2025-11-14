import { cn } from '@ci/shadcn';
import { Contact } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';
import { useMemoryService } from '../../useMemoryService';

import { GenericCard } from './GenericCard';

const PRIMARY_ICON_CLASS = 'text-[var(--primary)]';

export interface Props {
  memory: MemoryItem;
}

export function ContactCard({ memory }: Props) {
  const { setActiveMemory } = useMemoryService();

  const handleClick = () => {
    setActiveMemory(memory);
  };

  const ContactIcon = ({ className }: { className?: string }) => (
    <Contact className={cn(className, PRIMARY_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      tags={memory.tags}
      icon={ContactIcon}
      onClick={handleClick}
    />
  );
}
