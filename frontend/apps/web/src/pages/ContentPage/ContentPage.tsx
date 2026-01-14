import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Label, Textarea, Toggle, cn } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityGraph } from '@/components/EntityGraph';
import { ContentIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const GET_CONTENT = gql(`
  query GetContent($id: ID!) {
    content(id: $id) {
      id
      title
      text
    }
  }
`);

export function ContentPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_CONTENT, {
    variables: {
      id: GlobalUID.encode('content', id!),
    },
  });

  const contentItem = data?.content;

  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    contentItem?.title
      ? `Content - ${contentItem.title} - Companion Intelligence`
      : 'Content - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (contentItem == null) {
    content = <EmptyState icon={<ContentIcon size={48} colorized={false} />} message="Content not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ContentIcon />
            <h1 className="text-2xl font-bold">{contentItem.title}</h1>
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
                  icon={<ContentIcon size={48} colorized={false} />}
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
                <Label htmlFor="description">Text</Label>
                <Textarea
                  id="description"
                  defaultValue={contentItem?.text ?? ''}
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
              <Breadcrumb.Page>Content</Breadcrumb.Page>
            </Breadcrumb.Item>

            {contentItem && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{contentItem.title}</Breadcrumb.Page>
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
