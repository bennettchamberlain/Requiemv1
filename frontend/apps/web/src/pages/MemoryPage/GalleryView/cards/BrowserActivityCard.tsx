import { type MouseEvent, useMemo } from 'react';

import { BrowserActivityIcon } from '@/components/icons';
import { gql, useFragment, type FragmentType } from '@/graphql';

import { SearchCard } from '../SearchCard';

export const BROWSER_ACTIVITY_FRAGMENT = gql(`
  fragment GalleryBrowserActivityCardData on BrowserActivityType {
    id
    title
    url
  }
`);

interface Props {
  browserActivity: FragmentType<typeof BROWSER_ACTIVITY_FRAGMENT>;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function BrowserActivityCard({ browserActivity, onClick }: Props) {
  const data = useFragment(BROWSER_ACTIVITY_FRAGMENT, browserActivity);

  const domain = useMemo(() => {
    try {
      const urlObj = new URL(data.url);

      return urlObj.hostname;
    } catch {
      return data.url;
    }
  }, [data.url]);

  return (
    <SearchCard onClick={onClick}>
      <SearchCard.Header>
        <BrowserActivityIcon />

        <div className="text-md font-semibold truncate">Page view</div>
      </SearchCard.Header>

      <SearchCard.Content className="gap-8 items-center justify-center">
        <div>{data.title}</div>
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline text-blue-600 hover:text-blue-800"
        >
          {domain}
        </a>
      </SearchCard.Content>

      <SearchCard.Footer className="self-end">
        <div className="text-sm text-muted-foreground">Page view</div>
      </SearchCard.Footer>
    </SearchCard>
  );
}
