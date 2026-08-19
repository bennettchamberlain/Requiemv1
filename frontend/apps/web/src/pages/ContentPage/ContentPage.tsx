import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, usePageTitle, EmptyState } from '@ci/common';
import { useParams } from 'react-router-dom';

import { EntityEvolutionPanel } from '@/components/EntityEvolution/EntityEvolutionPanel';
import { EntityFieldsCard } from '@/components/EntityFields';
import { EntityGraph } from '@/components/EntityGraph';
import { EntityRelationshipCards } from '@/components/EntityRelationshipCards/EntityRelationshipCards';
import { EntityEditToggle, EntityTagsDescriptionCard } from '@/components/EntityTagsDescriptionCard';
import { ContentIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';
import {
  EntityMedia,
  resolveStaticUrl,
} from '@/pages/MemoryPage/Components/EntityDetails/EntityDetailScaffold';

const GET_CONTENT = gql(`
  query GetContent($id: ID!) {
    content(id: $id) {
      id
      title
      text
      # The drawer renders the image; the page used to select nothing to render it with.
      mimetype
      contentUrl: url
      sourceUrl
      tags {
        id
        label
      }
    }
  }
`);

// Same write the memory drawer makes (UpdateContentDetail), so the page can edit
// the title as well as the text instead of the text alone.
const UPDATE_CONTENT_FIELDS = gql(`
  mutation UpdateContentPageFields($input: UpdateContentInput!) {
    updateContent(input: $input) {
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

  const [updateContentFields] = useMutation(UPDATE_CONTENT_FIELDS);

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
          <EntityEditToggle pressed={editMode} onPressedChange={setEditMode} />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-4 md:col-span-2">
            {/* The drawer's field set and its media, so "Open full page" does not
                silently drop the title editor and the image. */}
            <EntityFieldsCard
              title="Content"
              resetKey={contentItem.id}
              editMode={editMode}
              onEditModeChange={setEditMode}
              fields={[{ key: 'title', label: 'Title', value: contentItem.title ?? '' }]}
              metaItems={[{ label: 'Type', value: contentItem.mimetype ?? 'Content' }]}
              onSave={async (values) => {
                const result = await updateContentFields({
                  variables: { input: { id: contentItem.id, title: values.title } },
                });

                if (!result.data?.updateContent) {
                  throw new Error('Update was rejected');
                }
              }}
            >
              {contentItem.mimetype?.startsWith('image/') && (
                <EntityMedia
                  src={resolveStaticUrl(contentItem.contentUrl ?? contentItem.sourceUrl)}
                  contentType={contentItem.mimetype}
                  alt={contentItem.title ?? ''}
                />
              )}
            </EntityFieldsCard>

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
              const result = await updateContentFields({
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

  return <>{content}</>;
}
