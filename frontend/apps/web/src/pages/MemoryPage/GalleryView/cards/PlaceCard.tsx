import { type MouseEvent } from 'react';

import { PlaceIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const PLACE_FRAGMENT = gql(`
  fragment GalleryPlaceCardData on PlaceType {
    id
    name
    description
  }
`);

interface Props {
  place: FragmentType<typeof PLACE_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function PlaceCard({ place, onClick }: Props) {
  const data = useFragment(PLACE_FRAGMENT, place);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <PlaceIcon />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.description}</div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Place</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
