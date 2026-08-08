import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Toggle } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityEvolutionPanel } from '@/components/EntityEvolution/EntityEvolutionPanel';
import { EntityGraph } from '@/components/EntityGraph';
import { EntityRelationshipCards } from '@/components/EntityRelationshipCards/EntityRelationshipCards';
import { EntityTagsDescriptionCard } from '@/components/EntityTagsDescriptionCard';
import { PlaceIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { Map } from '@/components/Map';
import { gql } from '@/graphql';

const GET_PLACE = gql(`
  query GetPlace($id: ID!) {
    place(id: $id) {
      id
      name
      description
      properties
      tags {
        id
        label
      }
    }
  }
`);

const UPDATE_PLACE_DESCRIPTION = gql(`
  mutation UpdatePlaceDescription($input: UpdatePlaceInput!) {
    updatePlace(input: $input) {
      id
      description
    }
  }
`);

export function PlacePage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_PLACE, {
    variables: {
      id: GlobalUID.encode('place', id!),
    },
  });

  const [updatePlaceDescription] = useMutation(UPDATE_PLACE_DESCRIPTION);

  const place = data?.place;
  const [editMode, setEditMode] = useState(false);

  usePageTitle(place?.name ? `${place.name} - Companion Intelligence` : 'Place - Companion Intelligence');

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (place == null) {
    content = <EmptyState icon={<PlaceIcon size={48} colorized={false} />} message="Place not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PlaceIcon />
            <h1 className="text-2xl font-bold">{place.name}</h1>
          </div>
          <Toggle
            aria-label="Toggle edit mode"
            size="sm"
            variant="outline"
            className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
            pressed={editMode}
            onPressedChange={setEditMode}
          >
            <Pencil />
          </Toggle>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <EntityTagsDescriptionCard
              entityType="place"
              entityId={id!}
              resetKey={place.id}
              tags={place.tags.map((t) => t.label)}
              description={place.description}
              editMode={editMode}
              className="h-full"
              contentClassName="h-full"
              onDescriptionSave={async (value) => {
                // UpdatePlaceInput requires `name`, so a description-only edit has to resend it.
                // That makes this a last-write-wins update on the name as well: if it was renamed
                // elsewhere since this page loaded, the cached value here would win. Same trade the
                // existing MemoryPage detail editors make, and the page has no polling to widen it.
                // The `?? ''` only fires when the stored name is genuinely null — the query selects
                // `name`, so it is not a projection gap — and null and '' both render as 'Unnamed'.
                // Omitting the field instead is not an option: it is non-null on the input.
                const result = await updatePlaceDescription({
                  variables: { input: { id: place.id, name: place.name ?? '', description: value } },
                });

                // updatePlace resolves to the place itself, or null when the write was rejected.
                if (!result.data?.updatePlace) {
                  throw new Error('Update was rejected');
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-4">
            {place.properties != null &&
              typeof place.properties.latitude === 'number' &&
              typeof place.properties.longitude === 'number' && (
                <Card className="p-0 overflow-hidden h-[300px]">
                  <Card.Content className="p-0 h-full w-full">
                    <Map
                      center={[place.properties.latitude, place.properties.longitude]}
                      zoomEnabled={false}
                      draggingEnabled={false}
                      zoom={15}
                    >
                      <Map.Marker position={[place.properties.latitude, place.properties.longitude]} />
                    </Map>
                  </Card.Content>
                </Card>
              )}

            <EntityGraph entityId={id!} />
          </div>
        </div>

        <EntityRelationshipCards entityId={id!} />
        <EntityEvolutionPanel entityId={id!} entityName={place.name} />
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

            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/places">Places</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>

            {place && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />

                <Breadcrumb.Item>
                  <Breadcrumb.Page>{place?.name || 'Unnamed'}</Breadcrumb.Page>
                </Breadcrumb.Item>
              </>
            )}
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      {content}
    </>
  );
}
