import type { MemoryItem } from '../types';

interface Props {
  memory: MemoryItem;
}

export function ContactDetails({ memory }: Props) {
  console.log(memory);

  return <div>Contact Details Component</div>;
}
