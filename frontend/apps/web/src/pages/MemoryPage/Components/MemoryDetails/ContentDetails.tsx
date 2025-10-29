import type { MemoryItem } from '../../types';

interface Props {
  memory: MemoryItem;
}

export function ContentDetails({ memory }: Props) {
  console.log(memory);

  return <div>Content Details Component</div>;
}
