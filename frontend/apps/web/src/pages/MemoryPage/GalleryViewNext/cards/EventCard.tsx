import { type MouseEvent } from 'react';

import { EventIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const EVENT_FRAGMENT = gql(`
  fragment GalleryEventCardData on EventType {
    id
    title
    description
  }
`);

interface Props {
  event: FragmentType<typeof EVENT_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function EventCard({ event, onClick }: Props) {
  const data = useFragment(EVENT_FRAGMENT, event);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <EventIcon />

        <div className="text-md font-semibold truncate">{data.title}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.description}</div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Event</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
