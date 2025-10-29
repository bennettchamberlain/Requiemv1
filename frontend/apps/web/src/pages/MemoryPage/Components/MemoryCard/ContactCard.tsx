import { Contact } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';

import { GenericCard } from './GenericCard';

const PRIMARY_ICON_CLASS = 'text-[var(--primary)]';

export interface Props {
  memory: MemoryItem;
}

export function ContactCard({ memory }: Props) {
  return <GenericCard memory={memory} Icon={Contact} iconColorClass={PRIMARY_ICON_CLASS} />;
}
