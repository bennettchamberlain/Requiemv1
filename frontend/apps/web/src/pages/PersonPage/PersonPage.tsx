import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { PersonIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
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

  usePageTitle(
    person?.name ? `Person - ${person.name} - Companion Intelligence` : 'Person - Companion Intelligence',
  );

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !person,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (person == null) {
    content = <EmptyState icon={<PersonIcon size={48} colorized={false} />} message="Person not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <PersonIcon />
          <h1 className="text-2xl font-bold">{person.name}</h1>
        </div>

        <p className="text-muted-foreground">{person.description}</p>

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
