import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Button, Card, Label, Textarea, Toggle, Tooltip, cn } from '@ci/shadcn';
import { Pencil, Link as LinkIcon } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { useTagEntityService } from '@/api';
import { EntityGraph } from '@/components/EntityGraph';
import { PersonIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { AddRelationshipModal } from '@/components/modals/AddItemModal/AddRelationshipModal';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const ALLOWED_TYPES = {
  communication: ['SENT', 'RECEIVED'],
  concept: ['PREFERS', 'DISLIKES', 'INTERESTED_IN'],
  content: ['CREATED'],
  event: ['ATTENDED'],
  item: ['OWNS'],
  note: ['CREATED'],
  person: [
    'KNOWS',
    'FRIENDS_WITH',
    'WORKS_WITH',
    'COLLABORATED_WITH',
    'MENTORED',
    'TAUGHT',
    'LEARNED_FROM',
    'PARTICIPATED_IN',
    'SPOUSE',
    'PARENT_OF',
    'CHILD_OF',
    'SIBLING_OF',
    'FAMILY_MEMBER',
    'MET_WITH',
    'EMAILED',
    'RECEIVED_EMAIL_FROM',
    'ORGANIZED_EVENT_WITH',
    'EDITED_WITH',
    'IS',
    'LIVES_WITH',
    'ASSOCIATED_WITH',
  ],
  place: ['LIVES_IN', 'STUDIES_AT', 'WORKS_AT', 'LIVES_NEAR', 'VISITED', 'OWNS'],
  thread: ['CREATED'],
};

const GET_PERSON = gql(`
  query GetPerson($id: ID!) {
    person(id: $id) {
      id
      name
      description
      tags {
        id
        label
      }
    }
  }
`);

export function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const [addRelationshipModalOpen, setAddRelationshipModalOpen] = useState(false);

  const { data, loading } = useQuery(GET_PERSON, {
    variables: {
      id: GlobalUID.encode('person', id!),
    },
  });

  const { tagEntities, untagEntities } = useTagEntityService();

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
          <div className="flex items-center gap-2">
            <Tooltip>
              <Tooltip.Trigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setAddRelationshipModalOpen(true)}
                  aria-label="Add relationship"
                >
                  <LinkIcon />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Add relationship</Tooltip.Content>
            </Tooltip>
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
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <EntityGraph entityId={id!} />
          </div>

          <Card className="p-0">
            <Card.Content className="p-4 flex flex-col gap-6">
              <div className="space-y-2">
                <Label>Tags</Label>

                <TagInput
                  key={person.id}
                  tags={person.tags.map((t) => t.label) ?? []}
                  readOnly={!editMode}
                  onTagAdded={(label) => {
                    tagEntities([GlobalUID.encode('person', id!)], [label]);

                    return true;
                  }}
                  onTagRemoved={async (label) => {
                    await untagEntities([GlobalUID.encode('person', id!)], [label]);
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  key={person.id}
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

      <AddRelationshipModal
        allowedRelationshipTypes={ALLOWED_TYPES}
        startId={id}
        open={addRelationshipModalOpen}
        onClose={() => setAddRelationshipModalOpen(false)}
      />
    </>
  );
}
