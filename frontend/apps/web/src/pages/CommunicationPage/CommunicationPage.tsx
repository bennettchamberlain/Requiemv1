import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { CommunicationIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
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

  usePageTitle(
    communication?.subject
      ? `Communication - ${communication.subject} - Companion Intelligence`
      : 'Communication - Companion Intelligence',
  );

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !communication,
  });

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
        <div className="flex items-center gap-2">
          <CommunicationIcon />
          <h1 className="text-2xl font-bold">{communication.subject}</h1>
        </div>

        <p className="text-muted-foreground">{communication.preview}</p>

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
