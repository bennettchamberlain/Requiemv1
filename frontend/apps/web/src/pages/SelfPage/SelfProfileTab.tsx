import { useState } from 'react';

import { useQuery } from '@apollo/client';

import { PageContent } from '@/components/layout';
import { EditPersonModal, PERSON_EDITOR_FIELDS } from '@/components/modals/AddItemModal/EditPersonModal';
import { PersonProfileCard } from '@/components/PersonForm';
import { gql, useFragment } from '@/graphql';
import { useCurrentUser } from '@/hooks';
import { AboutYouSection } from '@/pages/SettingsPage/sections/AboutYouSection';

const GET_SELF_PROFILE = gql(`
  query GetSelfProfile($id: ID!) {
    person(id: $id) {
      ...PersonEditorFields
    }
  }
`);

/**
 * Name, birthday, gender, pronouns and "about" all live on the Person entity
 * every user is already linked to (`me.entity`) — the same record `PersonForm`
 * edits for everyone else in the graph. Pointing that editor at your own
 * entity avoids a second, parallel set of profile fields on the User itself.
 */
export function SelfProfileTab() {
  const { user } = useCurrentUser();
  const [editOpen, setEditOpen] = useState(false);
  const entityId = user?.entity?.id ?? null;

  const { data } = useQuery(GET_SELF_PROFILE, {
    variables: { id: entityId ?? '' },
    skip: !entityId,
  });
  const profile = useFragment(PERSON_EDITOR_FIELDS, data?.person);

  return (
    <PageContent>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        {entityId && (
          <div>
            <h1 className="text-xl font-semibold">{profile?.name || user?.name || 'You'}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {profile?.description || 'No “about” written yet — add one from Edit below.'}
            </p>
          </div>
        )}

        {profile && <PersonProfileCard person={profile} onEdit={() => setEditOpen(true)} />}

        <AboutYouSection />
      </div>

      {entityId && <EditPersonModal personId={entityId} open={editOpen} onClose={() => setEditOpen(false)} />}
    </PageContent>
  );
}
