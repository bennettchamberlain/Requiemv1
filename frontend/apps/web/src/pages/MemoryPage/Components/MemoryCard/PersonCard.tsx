import { User } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';

import { GenericCard } from './GenericCard';

const PRIMARY_ICON_CLASS = 'text-[var(--primary)]';

export interface Props {
  memory: MemoryItem;
}

export function PersonCard({ memory }: Props) {
  return <GenericCard memory={memory} Icon={User} iconColorClass={PRIMARY_ICON_CLASS} />;
}
