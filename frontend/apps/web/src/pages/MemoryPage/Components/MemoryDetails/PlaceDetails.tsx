import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function PlaceDetails({ memory }: Props) {
  console.log(memory);

  return <div>Place Details Component</div>;
}
