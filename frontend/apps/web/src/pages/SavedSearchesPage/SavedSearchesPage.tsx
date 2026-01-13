import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { EmptyState, LoadingPage, Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { SavedSearchIcon } from '@/components/icons/SavedSeachIcon.tsx';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

import { DeleteSavedSearchModal } from './DeleteSavedSearchModal.tsx';
import { SavedSearch } from './SavedSearch.tsx';

const GET_SAVED_SEARCHES = gql(`
  query GetSavedSearches($first: Int, $after: String) {
    savedSearches(first: $first, after: $after) {
      edges {
        node {
          id
          ...SavedSearchGridItemFragment
        }
      }
    }
  }
`);

export function SavedSearchesPage() {
  usePageTitle('Saved Searches - Companion Intelligence');

  const { data, loading } = useQuery(GET_SAVED_SEARCHES, {
    variables: { first: 50 },
  });

  const [focusedSavedSearch, setFocusedSavedSearch] = useState<string | null>(null);

  const openSavedSearchModal = () => {
    console.log('open saved search modal');
  };

  const handleDelete = (e: React.MouseEvent, savedSearchId: string) => {
    e.preventDefault();
    e.stopPropagation();

    setFocusedSavedSearch(savedSearchId);
  };

  const savedSearches = data?.savedSearches?.edges.map((edge) => edge.node) || [];

  let content: ReactNode;

  if (loading) {
    content = <LoadingPage />;
  } else if (savedSearches.length === 0) {
    content = (
      <EmptyState
        icon={<SavedSearchIcon size={48} colorized={false} />}
        message={
          <>
            <div>You don't have any Saved Searches yet.</div>
          </>
        }
      />
    );
  } else {
    content = (
      <PageContent>
        <div className="grid w-full gap-4 justify-center grid-cols-[repeat(auto-fill,300px)] auto-rows-[300px]">
          {savedSearches.map((savedSearch) => (
            <SavedSearch
              key={savedSearch.id}
              savedSearch={savedSearch}
              onDelete={(e) => handleDelete(e, savedSearch.id)}
              openSavedSearchModal={openSavedSearchModal}
            />
          ))}
        </div>
      </PageContent>
    );
  }

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/feed">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>

            <Breadcrumb.Separator className="hidden md:block" />

            <Breadcrumb.Item>
              <Breadcrumb.Page>Saved Searches</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      {content}

      {focusedSavedSearch && (
        <DeleteSavedSearchModal
          savedSearchId={focusedSavedSearch}
          onClose={() => setFocusedSavedSearch(null)}
        />
      )}
    </>
  );
}
