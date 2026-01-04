import { type MouseEvent } from 'react';

import { PersonIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const PERSON_FRAGMENT = gql(`
  fragment GalleryPersonCardData on PersonType {
    id
    name
    description
  }
`);

interface Props {
  person: FragmentType<typeof PERSON_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function PersonCard({ person, onClick }: Props) {
  const data = useFragment(PERSON_FRAGMENT, person);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <PersonIcon />

        <div className="text-md font-semibold truncate">{data.name}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.description}</div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Person</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
