import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function ThingDetails({ memory }: Props) {
  console.log(memory);

  return <div>Thing Details Component</div>;
}
