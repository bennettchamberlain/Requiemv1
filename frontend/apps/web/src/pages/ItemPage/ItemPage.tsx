import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { ItemIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_ITEM = gql(`
  query GetItem($id: ID!) {
    item(id: $id) {
      id
      name
      description
    }
  }
`);

export function ItemPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_ITEM, {
    variables: {
      id: GlobalUID.encode('item', id!),
    },
  });

  const item = data?.item;

  usePageTitle(item?.name ? `Item - ${item.name} - Companion Intelligence` : 'Item - Companion Intelligence');

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !item,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (item == null) {
    content = <EmptyState icon={<ItemIcon size={48} colorized={false} />} message="Item not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <ItemIcon />
          <h1 className="text-2xl font-bold">{item.name}</h1>
        </div>

        <p className="text-muted-foreground">{item.description}</p>

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
              <Breadcrumb.Page>Item</Breadcrumb.Page>
            </Breadcrumb.Item>

            {item && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{item.name}</Breadcrumb.Page>
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
