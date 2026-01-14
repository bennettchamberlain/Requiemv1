import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Label, Textarea, Toggle, cn } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityGraph } from '@/components/EntityGraph';
import { PersonIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const GET_PERSON = gql(`
  query GetPerson($id: ID!) {
    person(id: $id) {
      id
      name
      description
    }
  }
`);

export function PersonPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_PERSON, {
    variables: {
      id: GlobalUID.encode('person', id!),
    },
  });

  const person = data?.person;
  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    person?.name ? `Person - ${person.name} - Companion Intelligence` : 'Person - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (person == null) {
    content = <EmptyState icon={<PersonIcon size={48} colorized={false} />} message="Person not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PersonIcon />
            <h1 className="text-2xl font-bold">{person.name}</h1>
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
            <EntityGraph
              entityId={id!}
              emptyState={
                <EmptyState
                  icon={<PersonIcon size={48} colorized={false} />}
                  message="No graph data available"
                />
              }
            />
          </div>

          <Card className="p-0">
            <Card.Content className="p-4 flex flex-col gap-6">
              <div className="space-y-2">
                <Label>Tags</Label>

                <TagInput tags={['bug', 'feature']} readOnly={!editMode} onTagAdded={() => true} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  defaultValue={person.description ?? ''}
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
              <Breadcrumb.Page>People</Breadcrumb.Page>
            </Breadcrumb.Item>

            {person && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />

                <Breadcrumb.Item>
                  <Breadcrumb.Page>{person?.name || 'Unnamed'}</Breadcrumb.Page>
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
