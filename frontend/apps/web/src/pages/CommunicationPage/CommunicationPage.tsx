import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Label, Textarea, Toggle, cn } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityGraph } from '@/components/EntityGraph';
import { CommunicationIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const GET_COMMUNICATION = gql(`
  query GetCommunication($id: ID!) {
    communication(id: $id) {
      id
      subject
      preview
    }
  }
`);

export function CommunicationPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_COMMUNICATION, {
    variables: {
      id: GlobalUID.encode('communication', id!),
    },
  });

  const communication = data?.communication;

  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    communication?.subject
      ? `Communication - ${communication.subject} - Companion Intelligence`
      : 'Communication - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (communication == null) {
    content = (
      <EmptyState
        icon={<CommunicationIcon size={48} colorized={false} />}
        message="Communication not found"
      />
    );
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CommunicationIcon />
            <h1 className="text-2xl font-bold">{communication.subject}</h1>
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
            <EntityGraph entityId={id!} />
          </div>

          <Card className="p-0">
            <Card.Content className="p-4 flex flex-col gap-6">
              <div className="space-y-2">
                <Label>Tags</Label>

                <TagInput tags={['bug', 'feature']} readOnly={!editMode} onTagAdded={() => true} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Preview</Label>
                <Textarea
                  id="preview"
                  defaultValue={communication?.preview ?? ''}
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
              <Breadcrumb.Page>Communication</Breadcrumb.Page>
            </Breadcrumb.Item>

            {communication && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{communication.subject}</Breadcrumb.Page>
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
