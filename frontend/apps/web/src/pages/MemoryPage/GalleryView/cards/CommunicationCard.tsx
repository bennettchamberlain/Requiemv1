import { type MouseEvent } from 'react';

import { CommunicationIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const COMMUNICATION_FRAGMENT = gql(`
  fragment GalleryCommunicationCardData on CommunicationType {
    id
    subject
    preview
  }
`);

interface Props {
  communication: FragmentType<typeof COMMUNICATION_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function CommunicationCard({ communication, onClick }: Props) {
  const data = useFragment(COMMUNICATION_FRAGMENT, communication);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <CommunicationIcon />

        <div className="text-md font-semibold truncate">{data.subject}</div>
      </SearchCard.Header>

      <SearchCard.Content>
        <div className="line-clamp-3 leading-tight">{data.preview}</div>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Communication</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
