import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function ConceptDetails({ memory }: Props) {
  console.log(memory);

  return <div>Concept Details Component</div>;
}
