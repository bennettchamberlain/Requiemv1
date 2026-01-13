import { type ReactNode } from 'react';

import { useQuery } from '@apollo/client';
import { GlobalUID, LoadingPage, Portal, usePageTitle, EmptyState } from '@ci/common';
import { Breadcrumb, Card } from '@ci/shadcn';
import { useParams, Link } from 'react-router-dom';

import { useNodeGraphService } from '@/api/useNodeGraphService';
import { ForceGraph } from '@/components/ForceGraph';
import { EventIcon } from '@/components/icons';
import { PageContent } from '@/components/layout';
import { gql } from '@/graphql';

const GET_EVENT = gql(`
  query GetEvent($id: ID!) {
    event(id: $id) {
      id
      title
      description
    }
  }
`);

export function EventPage() {
  const { id } = useParams<{ id: string }>();

  const { data, loading } = useQuery(GET_EVENT, {
    variables: {
      id: GlobalUID.encode('event', id!),
    },
  });

  const event = data?.event;

  usePageTitle(
    event?.title ? `Event - ${event.title} - Companion Intelligence` : 'Event - Companion Intelligence',
  );

  const { data: graphData } = useNodeGraphService({
    entityId: id,
    skip: !event,
  });

  let content: ReactNode | null = null;

  if (loading) {
    content = <LoadingPage />;
  } else if (event == null) {
    content = <EmptyState icon={<EventIcon size={48} colorized={false} />} message="Event not found" />;
  } else {
    content = (
      <PageContent>
        <div className="flex items-center gap-2">
          <EventIcon />
          <h1 className="text-2xl font-bold">{event.title}</h1>
        </div>

        <p className="text-muted-foreground">{event.description}</p>

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
              <Breadcrumb.Page>Event</Breadcrumb.Page>
            </Breadcrumb.Item>

            {event && (
              <>
                <Breadcrumb.Separator className="hidden md:block" />
                <Breadcrumb.Item>
                  <Breadcrumb.Page>{event.title}</Breadcrumb.Page>
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
