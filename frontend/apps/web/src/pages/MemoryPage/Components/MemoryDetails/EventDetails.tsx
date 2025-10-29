import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function EventDetails({ memory }: Props) {
  console.log(memory);

  return <div>Event Details Component</div>;
}
