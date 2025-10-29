import { FileText, Video, File } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';
const DESTRUCTIVE_ICON_CLASS = 'text-[var(--destructive)]';

export interface Props {
  memory: MemoryItem;
}

export function ContentCard({ memory }: Props) {
  const entityType = memory.metadata?.entityType as string | undefined;

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
}
