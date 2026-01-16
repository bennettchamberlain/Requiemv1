import { type ReactNode, useState } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card, Label, Toggle } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityGraph } from '@/components/EntityGraph';
import { FileIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { TagInput } from '@/components/TagInput';
import { gql } from '@/graphql';

const GET_FILE = gql(`
  query GetFile($id: ID!) {
    file(id: $id) {
      id
      originalName
      url
    }
  }
`);

export function FilePage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_FILE, {
    variables: {
      id: GlobalUID.encode('file', id!),
    },
  });

  const file = data?.file;
  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    file?.originalName
      ? `File - ${file.originalName} - Companion Intelligence`
      : 'File - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (file == null) {
    content = <EmptyState icon={<FileIcon size={48} colorized={false} />} message="File not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileIcon />
            <h1 className="text-2xl font-bold break-all">{file.originalName}</h1>
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
          <div className="md:col-span-2 space-y-4">
            <EntityGraph entityId={id!} />
            <div className="border rounded-md p-4 bg-muted/20 flex justify-center">
              {/* Display image if url is an image, otherwise just link */}
              <img src={file.url} alt="File content" className="max-w-full h-auto rounded-md shadow-sm" />
            </div>
          </div>

          <Card className="p-0 h-fit">
            <Card.Content className="p-4 flex flex-col gap-6">
              <div className="space-y-2">
                <Label>Tags</Label>
                <TagInput tags={['bug', 'feature']} readOnly={!editMode} onTagAdded={() => true} />
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
              <Breadcrumb.Page>File</Breadcrumb.Page>
            </Breadcrumb.Item>

            {file && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page className="max-w-[200px] truncate">{file.originalName}</Breadcrumb.Page>
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
