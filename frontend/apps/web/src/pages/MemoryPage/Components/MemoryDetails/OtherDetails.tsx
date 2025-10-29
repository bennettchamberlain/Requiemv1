import type { MemoryItem } from '../types';

interface Props {
  memory: MemoryItem;
}

export function OtherDetails({ memory }: Props) {
  console.log(memory);

  return <div>Other Details Component</div>;
}
