import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { ContentIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
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

  usePageTitle(
    contentItem?.title
      ? `Content - ${contentItem.title} - Companion Intelligence`
      : 'Content - Companion Intelligence',
  );

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !contentItem,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (contentItem == null) {
    content = <EmptyState icon={<ContentIcon size={48} colorized={false} />} message="Content not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <ContentIcon />
          <h1 className="text-2xl font-bold">{contentItem.title}</h1>
        </div>
        <p className="text-muted-foreground">{contentItem.text}</p>

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
