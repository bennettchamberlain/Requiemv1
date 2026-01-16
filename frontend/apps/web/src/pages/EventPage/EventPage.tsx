import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Label, Textarea, Toggle, cn } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { useTagEntityService } from '@/api';
import { EventIcon, PlaceIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const GET_EVENT = gql(`
  query GetEvent($id: ID!) {
    event(id: $id) {
      id
      title
      description
      tags {
        label
      }
      location {
        id
        name
      }
      participants {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  }
`);

export function EventPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_EVENT, {
    variables: {
      id: GlobalUID.encode('event', id!),
    },
  });

  const { tagEntities, untagEntities } = useTagEntityService();

  const event = data?.event;

  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    event?.title ? `Event - ${event.title} - Companion Intelligence` : 'Event - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (event == null) {
    content = <EmptyState icon={<EventIcon size={48} colorized={false} />} message="Event not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <EventIcon />
            <h1 className="text-2xl font-bold">{event.title}</h1>
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
            <Card className="p-0">
              <Card.Content className="p-4 flex flex-col gap-6">
                {event.participants.edges.length > 0 && (
                  <div className="mb-2">
                    <Label>Participants</Label>
                    {event.participants.edges.map(({ node }) => (
                      <div key={node.id}>{node.name}</div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Tags</Label>

                  <TagInput
                    key={event.id}
                    tags={event.tags.map((t) => t.label) ?? []}
                    readOnly={!editMode}
                    onTagAdded={async (label) => {
                      try {
                        await tagEntities([GlobalUID.encode('event', id!)], [label]);

                        return true;
                      } catch {
                        return false;
                      }
                    }}
                    onTagRemoved={async (label) => {
                      await untagEntities([GlobalUID.encode('event', id!)], [label]);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    key={event.id}
                    id="description"
                    defaultValue={event.description ?? ''}
                    readOnly={!editMode}
                    className={cn(
                      'resize-none min-h-[120px]',
                      editMode ? '' : 'shadow-none focus-visible:ring-0 focus-visible:border-border',
                    )}
                  />
                </div>
              </Card.Content>
            </Card>
          </div>

          <Card className="p-0">
            <Card.Content className="p-4 flex flex-col gap-6">
              {event.location && (
                <div className="flex items-center gap-2">
                  <PlaceIcon />
                  <div>{event.location.name}</div>
                </div>
              )}
            </Card.Content>
          </Card>
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

            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Page>Event</Breadcrumb.Page>
            </Breadcrumb.Item>

            {event && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{event.title}</Breadcrumb.Page>
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
