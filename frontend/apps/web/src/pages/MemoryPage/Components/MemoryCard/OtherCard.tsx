import { Target, Radio } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';
const MUTED_ICON_CLASS = 'text-[var(--muted-foreground)]';

export interface Props {
  memory: MemoryItem;
}

export function OtherCard({ memory }: Props) {
  const entityType = memory.metadata?.entityType as string | undefined;

  if (entityType === 'Channel') {
    return <GenericCard memory={memory} Icon={Radio} iconColorClass={ACCENT_ICON_CLASS} />;
  }

  return <GenericCard memory={memory} Icon={Target} iconColorClass={MUTED_ICON_CLASS} />;
}
