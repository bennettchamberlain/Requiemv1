import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Toggle, Tooltip } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'react-router-dom';

import { EntityEvolutionPanel } from '@/components/EntityEvolution/EntityEvolutionPanel';
import { EntityGraph } from '@/components/EntityGraph';
import { EntityRelationshipCards } from '@/components/EntityRelationshipCards/EntityRelationshipCards';
import { EntityTagsDescriptionCard } from '@/components/EntityTagsDescriptionCard';
import { ContentIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_CONTENT = gql(`
  query GetContent($id: ID!) {
    content(id: $id) {
      id
      title
      text
      tags {
        id
        label
      }
    }
  }
`);

const UPDATE_CONTENT_TEXT = gql(`
  mutation UpdateContentText($input: UpdateContentInput!) {
    updateContent(input: $input) {
      id
      text
    }
  }
`);

export function ContentPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_CONTENT, {
    variables: {
      id: GlobalUID.encode('content', id!),
    },
  });

  const [updateContentText] = useMutation(UPDATE_CONTENT_TEXT);

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
          <Tooltip delayDuration={600}>
            <Tooltip.Content>{t('ENTITY_EDIT_TOGGLE')}</Tooltip.Content>
            <Tooltip.Trigger asChild>
              <Toggle
                aria-label={t('ENTITY_EDIT_TOGGLE')}
                size="sm"
                variant="outline"
                className="data-[state=on]:bg-transparent data-[state=on]:*:[svg]:fill-blue-500 data-[state=on]:*:[svg]:stroke-blue-500"
                pressed={editMode}
                onPressedChange={setEditMode}
              >
                <Pencil />
              </Toggle>
            </Tooltip.Trigger>
          </Tooltip>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <EntityGraph entityId={id!} />
          </div>
          <EntityTagsDescriptionCard
            entityType="content"
            entityId={id!}
            resetKey={contentItem.id}
            tags={contentItem.tags.map((t) => t.label)}
            description={contentItem.text}
            descriptionLabel="Text"
            editMode={editMode}
            onDescriptionSave={async (value) => {
              const result = await updateContentText({
                variables: { input: { id: contentItem.id, text: value } },
              });

              // updateContent resolves to the content itself, or null when the write was rejected.
              if (!result.data?.updateContent) {
                throw new Error('Update was rejected');
              }
            }}
          />
        </div>

        <EntityRelationshipCards entityId={id!} />
        <EntityEvolutionPanel entityId={id!} />
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
