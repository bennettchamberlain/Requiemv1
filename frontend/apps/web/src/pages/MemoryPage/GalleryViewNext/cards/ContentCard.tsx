import { type MouseEvent } from 'react';

import { ContentIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const CONTENT_FRAGMENT = gql(`
  fragment GalleryContentCardData on ContentType {
    id
    title
    text
  }
`);

interface Props {
  content: FragmentType<typeof CONTENT_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function ContentCard({ content, onClick }: Props) {
  const data = useFragment(CONTENT_FRAGMENT, content);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <ContentIcon />

        <div className="text-md font-semibold truncate">{data.title}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.text}</div>
      </SearchCard.Content>

      <SearchCard.Footer>
        <div className="text-sm text-muted-foreground">Content</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
