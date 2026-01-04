import { type MouseEvent } from 'react';

import { ThreadIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const THREAD_FRAGMENT = gql(`
  fragment GalleryThreadCardData on ThreadType {
    id
    name
    description
  }
`);

interface Props {
  thread: FragmentType<typeof THREAD_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function ThreadCard({ thread, onClick }: Props) {
  const data = useFragment(THREAD_FRAGMENT, thread);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <ThreadIcon />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.description}</div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Thread</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
