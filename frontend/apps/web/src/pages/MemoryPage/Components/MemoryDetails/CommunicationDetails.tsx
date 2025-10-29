import type { MemoryItem } from '../types';

interface Props {
  memory: MemoryItem;
}

export function CommunicationDetails({ memory }: Props) {
  console.log(memory);

  return <div>Communication Details Component</div>;
}
