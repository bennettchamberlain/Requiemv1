import { cn } from '@ci/shadcn';
import { Package } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';
import { useMemoryService } from '../../useMemoryService';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';

export interface Props {
  memory: MemoryItem;
}

export function ThingCard({ memory }: Props) {
  const { setActiveMemory } = useMemoryService();

  const handleClick = () => {
    setActiveMemory(memory);
  };

  const PackageIcon = ({ className }: { className?: string }) => (
    <Package className={cn(className, ACCENT_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      tags={memory.tags}
      icon={PackageIcon}
      onClick={handleClick}
    />
  );
}
