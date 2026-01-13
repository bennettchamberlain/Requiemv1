import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { ConceptIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_CONCEPT = gql(`
  query GetConcept($id: ID!) {
    concept(id: $id) {
      id
      name
      description
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

  const concept = data?.concept;

  usePageTitle(
    concept?.name ? `Concept - ${concept.name} - Companion Intelligence` : 'Concept - Companion Intelligence',
  );

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !concept,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (concept == null) {
    content = <EmptyState icon={<ConceptIcon size={48} colorized={false} />} message="Concept not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <ConceptIcon />
          <h1 className="text-2xl font-bold">{concept.name}</h1>
        </div>

        <p className="text-muted-foreground">{concept.description}</p>

        <Card className="p-0">
          <Card.Content className="p-0">
            <ForceGraph
              nodes={graphData?.nodes ?? []}
              links={graphData?.links ?? []}
              highlightedNodeId={id}
              centerNodeId={id}
              selectedNodeId={id}
            />
          </Card.Content>
        </Card>
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
