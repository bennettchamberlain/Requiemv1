import { Lightbulb } from '@ci/shadcn/icons';

import type { MemoryItem } from '../../types';

import { GenericCard } from './GenericCard';

const ACCENT_ICON_CLASS = 'text-[var(--accent-foreground)]';

export interface Props {
  memory: MemoryItem;
}

export function ConceptCard({ memory }: Props) {
  return <GenericCard memory={memory} Icon={Lightbulb} iconColorClass={ACCENT_ICON_CLASS} />;
}
