import { cn } from '@ci/shadcn';
import { User } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';
import { useMemoryService } from '../../useMemoryService';

import { GenericCard } from './GenericCard';

const PRIMARY_ICON_CLASS = 'text-[var(--primary)]';

export interface Props {
  memory: MemoryItem;
}

export function PersonCard({ memory }: Props) {
  const { setActiveMemory } = useMemoryService();

  const handleClick = () => {
    setActiveMemory(memory);
  };

  const UserIcon = ({ className }: { className?: string }) => (
    <User className={cn(className, PRIMARY_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      tags={memory.tags}
      icon={UserIcon}
      onClick={handleClick}
    />
  );
}
