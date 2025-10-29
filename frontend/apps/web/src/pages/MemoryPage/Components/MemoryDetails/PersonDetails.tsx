import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function PersonDetails({ memory }: Props) {
  console.log(memory);

  return <div>Person Details Component</div>;
}
