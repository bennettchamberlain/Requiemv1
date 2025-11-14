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

  const preview =
    memory.tags.length > 0 ? (
      <div className="flex flex-wrap gap-2">
        {memory.tags.map((tag, index) => (
          <span key={index} className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded-full">
            {tag}
          </span>
        ))}
      </div>
    ) : null;

  const UserIcon = ({ className }: { className?: string }) => (
    <User className={cn(className, PRIMARY_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      preview={preview}
      icon={UserIcon}
      onClick={handleClick}
    />
  );
}
