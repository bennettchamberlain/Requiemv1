import { cn } from '@ci/shadcn';
import { Target, Radio } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';
import { useMemoryService } from '../../useMemoryService';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';
const MUTED_ICON_CLASS = 'text-[var(--muted-foreground)]';

export interface Props {
  memory: MemoryItem;
}

export function OtherCard({ memory }: Props) {
  const { setActiveMemory } = useMemoryService();
  const entityType = memory.metadata?.entityType as string | undefined;

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

  if (entityType === 'Channel') {
    const RadioIcon = ({ className }: { className?: string }) => (
      <Radio className={cn(className, ACCENT_ICON_CLASS)} />
    );

    return (
      <GenericCard
        title={memory.title}
        subtitle={memory.category}
        description={memory.description || undefined}
        preview={preview}
        icon={RadioIcon}
        onClick={handleClick}
      />
    );
  }

  const TargetIcon = ({ className }: { className?: string }) => (
    <Target className={cn(className, MUTED_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      preview={preview}
      icon={TargetIcon}
      onClick={handleClick}
    />
  );
}
