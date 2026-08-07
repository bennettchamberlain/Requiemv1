import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Toggle } from '@ci/shadcn';
import { Pencil } from '@ci/shadcn/icons';
import { useParams, Link } from 'react-router-dom';

import { EntityEvolutionPanel } from '@/components/EntityEvolution/EntityEvolutionPanel';
import { EntityGraph } from '@/components/EntityGraph';
import { EntityRelationshipCards } from '@/components/EntityRelationshipCards/EntityRelationshipCards';
import { EntityTagsDescriptionCard } from '@/components/EntityTagsDescriptionCard';
import { ConceptIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_CONCEPT = gql(`
  query GetConcept($id: ID!) {
    concept(id: $id) {
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

const UPDATE_CONCEPT_DESCRIPTION = gql(`
  mutation UpdateConceptDescription($input: UpdateConceptInput!) {
    updateConcept(input: $input) {
      success
      concept {
        id
        description
      }
    }
  }
`);

export function ConceptPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_CONCEPT, {
    variables: {
      id: GlobalUID.encode('concept', id!),
    },
  });

  const [updateConceptDescription] = useMutation(UPDATE_CONCEPT_DESCRIPTION);

  const concept = data?.concept;

  const [editMode, setEditMode] = useState(false);

  usePageTitle(
    concept?.name ? `Concept - ${concept.name} - Companion Intelligence` : 'Concept - Companion Intelligence',
  );

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (concept == null) {
    content = <EmptyState icon={<ConceptIcon size={48} colorized={false} />} message="Concept not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ConceptIcon />
            <h1 className="text-2xl font-bold">{concept.name}</h1>
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

          <EntityTagsDescriptionCard
            entityType="concept"
            entityId={id!}
            resetKey={concept.id}
            tags={concept.tags.map((tag) => tag.label)}
            description={concept.description}
            editMode={editMode}
            onDescriptionSave={async (value) => {
              // `name` is non-null on UpdateConceptInput, so it is resent unchanged rather than
              // omitted — leaving it out fails schema validation before the request is sent.
              const result = await updateConceptDescription({
                variables: { input: { id: concept.id, name: concept.name ?? '', description: value } },
              });

              if (!result.data?.updateConcept.success) {
                throw new Error('Update was rejected');
              }
            }}
          />
        </div>

        <EntityRelationshipCards entityId={id!} />
        <EntityEvolutionPanel entityId={id!} entityName={concept.name} />
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
              <Breadcrumb.Page>Concepts</Breadcrumb.Page>
            </Breadcrumb.Item>

            {concept && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />

                <Breadcrumb.Item>
                  <Breadcrumb.Page>{concept?.name || 'Unnamed'}</Breadcrumb.Page>
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
