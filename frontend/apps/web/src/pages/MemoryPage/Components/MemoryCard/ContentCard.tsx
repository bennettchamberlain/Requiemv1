import { cn } from '@ci/shadcn';
import { FileText, Video, File } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';
import { useMemoryService } from '../../useMemoryService';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';
const DESTRUCTIVE_ICON_CLASS = 'text-[var(--destructive)]';

export interface Props {
  memory: MemoryItem;
}

export function ContentCard({ memory }: Props) {
  const { setActiveMemory } = useMemoryService();
  const entityType = memory.metadata?.entityType as string | undefined;

  const handleClick = () => {
    setActiveMemory(memory);
  };

  if (entityType === 'Video') {
    const VideoIcon = ({ className }: { className?: string }) => (
      <Video className={cn(className, DESTRUCTIVE_ICON_CLASS)} />
    );

    return (
      <GenericCard
        title={memory.title}
        subtitle={memory.category}
        description={memory.description || undefined}
        tags={memory.tags}
        icon={VideoIcon}
        onClick={handleClick}
      />
    );
  }

  if (entityType === 'File') {
    const FileIcon = ({ className }: { className?: string }) => (
      <File className={cn(className, ACCENT_ICON_CLASS)} />
    );

    return (
      <GenericCard
        title={memory.title}
        subtitle={memory.category}
        description={memory.description || undefined}
        tags={memory.tags}
        icon={FileIcon}
        onClick={handleClick}
      />
    );
  }

  if (entityType === 'Document') {
    const FileTextIcon = ({ className }: { className?: string }) => (
      <FileText className={cn(className, ACCENT_ICON_CLASS)} />
    );

    return (
      <GenericCard
        title={memory.title}
        subtitle={memory.category}
        description={memory.description || undefined}
        tags={memory.tags}
        icon={FileTextIcon}
        onClick={handleClick}
      />
    );
  }

  const FileTextIcon = ({ className }: { className?: string }) => (
    <FileText className={cn(className, ACCENT_ICON_CLASS)} />
  );

  return (
    <GenericCard
      title={memory.title}
      subtitle={memory.category}
      description={memory.description || undefined}
      tags={memory.tags}
      icon={FileTextIcon}
      onClick={handleClick}
    />
  );
}
