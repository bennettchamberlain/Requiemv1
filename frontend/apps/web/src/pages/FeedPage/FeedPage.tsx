import { useCallback, useEffect, useMemo, type ComponentProps } from 'react';

import { GlobalUID, ErrorPage, LoadingPage, Portal, useDeviceLayout, usePageTitle } from '@ci/common';
import { Breadcrumb, cn } from '@ci/shadcn';
import { useNavigate, useParams, Link } from 'react-router-dom';

import { useActionListService, useSummariesService } from '@/api';
import { PageContent } from '@/components/layout';
import { Markdown } from '@/components/Markdown';
import { useModalControls } from '@/hooks';

import { BentoCard } from '../../components/BentoCard';
import { Carousel } from '../../components/Carousel';

import { actionInsightData } from './data';
import { FeedModal } from './FeedModal';
import { SummaryCard } from './SummaryCard';
import type { FeedItem } from './types';

type CarouselProps = Partial<ComponentProps<typeof Carousel>>;

export function FeedPage() {
  usePageTitle('Feed - Companion Intelligence');

  const { isMobile } = useDeviceLayout();
  const navigate = useNavigate();

  const { id: actionId } = useParams<{ id?: string }>();
  const [{ data: actions, loading, error }] = useActionListService();
  const [{ data: summaries, loading: summariesLoading, error: summariesError }] = useSummariesService(10);

  // Intersperse real summaries between placeholder insight cards
  const combinedInsights = useMemo(() => {
    const result: Array<
      { type: 'insight'; data: FeedItem } | { type: 'summary'; data: (typeof summaries)[number] }
    > = [];

    // Add first insight card
    if (actionInsightData[0]) {
      result.push({ type: 'insight', data: actionInsightData[0] });
    }

    // Add real summaries interspersed with remaining insight cards
    let insightIndex = 1;
    summaries.forEach((summary) => {
      result.push({ type: 'summary', data: summary });

      // Add insight card after every summary (if available)
      if (insightIndex < actionInsightData.length) {
        result.push({ type: 'insight', data: actionInsightData[insightIndex] });
        insightIndex++;
      }
    });

    // Add any remaining insight cards at the end
    while (insightIndex < actionInsightData.length) {
      result.push({ type: 'insight', data: actionInsightData[insightIndex] });
      insightIndex++;
    }

    return result;
  }, [summaries]);

  const selectedActionIndex = useMemo(
    () => actions.findIndex((item) => item.id === actionId),
    [actions, actionId],
  );

  const [{ isOpen: isModalOpen }, { open: openModal, close: closeModal }] = useModalControls({
    open: selectedActionIndex >= 0,
  });

  useEffect(() => {
    if (selectedActionIndex >= 0) {
      openModal();
    } else {
      closeModal();
    }
  }, [selectedActionIndex, openModal]);

  const handleCardClick = useCallback(
    (id: string) => {
      navigate(`/feed/${id}`, { replace: true });
      openModal();
    },
    [navigate, openModal],
  );

  const handleModalClose = useCallback(() => {
    navigate('/feed', { replace: true });
    closeModal();
  }, [navigate, closeModal]);

  const handleSummaryClick = useCallback(
    (encodedId: string) => {
      const decodedId = GlobalUID.decode(encodedId).id;
      navigate(`/insights/${decodedId}`);
    },
    [navigate],
  );

  if (loading) {
    return (
      <PageContent>
        <LoadingPage />
      </PageContent>
    );
  }

  if (error) {
    return (
      <PageContent>
        <ErrorPage error={error} />
      </PageContent>
    );
  }

  if (isMobile) {
    const carouselProps = {
      className: 'h-full -mx-2',
      containerClassName: 'h-full',
      slideClassName: 'h-full px-2',
      initialIndex: selectedActionIndex,
    } satisfies CarouselProps;

    return (
      <PageContent>
        <Carousel {...carouselProps}>
          {!loading &&
            !error &&
            actions.map((action) => (
              <BentoCard
                key={action.id}
                title={action.title}
                description={
                  <div className="prose dark:prose-invert">
                    <Markdown>{action.text}</Markdown>
                  </div>
                }
                tags={action.tags}
                imageUrl={action.imageUrl}
                onClick={() => handleCardClick(action.id)}
              />
            ))}

          {combinedInsights.map((item) => {
            if (item.type === 'insight') {
              return (
                <BentoCard
                  key={item.data.id}
                  title={item.data.title}
                  description={item.data.description}
                  tags={item.data.tags}
                  className="cursor-default opacity-95"
                />
              );
            } else {
              return (
                <SummaryCard
                  key={item.data.id}
                  summary={item.data}
                  onClick={() => handleSummaryClick(item.data.id)}
                />
              );
            }
          })}
        </Carousel>

        {(summariesLoading || summariesError) && (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {summariesLoading
              ? 'Fetching your personalized insights...'
              : 'We could not load live insights. Preview cards are shown until the service recovers.'}
          </div>
        )}

        {isModalOpen && <FeedModal onClose={handleModalClose} />}
      </PageContent>
    );
  }

  const carouselProps = {
    className: '-mx-6',
    containerClassName: 'px-6 pb-6 pt-1',
    slideClassName: 'flex-none min-w-[550px] basis-[550px] mr-6',
  } satisfies CarouselProps;

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
            <Breadcrumb.Item>
              <Breadcrumb.Page>Feed</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <h2 className="text-2xl font-bold text-foreground">Actions</h2>

        <Carousel {...carouselProps} initialIndex={selectedActionIndex}>
          {!loading &&
            !error &&
            actions.map((action) => (
              <BentoCard
                key={action.id}
                title={action.title}
                description={
                  <div className="prose dark:prose-invert">
                    <Markdown>{action.text}</Markdown>
                  </div>
                }
                tags={action.tags}
                imageUrl={action.imageUrl}
                onClick={() => handleCardClick(action.id)}
                className="hover:shadow-lg transition-shadow duration-200"
              />
            ))}
        </Carousel>

        <h2 className="text-2xl font-bold text-foreground">Insights</h2>

        <div className="space-y-3">
          {(summariesLoading || summariesError) && (
            <div className={cn('text-sm', summariesError ? 'text-destructive' : 'text-muted-foreground')}>
              {summariesLoading
                ? 'Fetching your personalized insights...'
                : 'We could not load live insights. Preview cards are shown until the service recovers.'}
            </div>
          )}

          <Carousel {...carouselProps}>
            {combinedInsights.map((item) => {
              if (item.type === 'insight') {
                return (
                  <BentoCard
                    key={item.data.id}
                    title={item.data.title}
                    description={item.data.description}
                    tags={item.data.tags}
                    className="hover:shadow-lg transition-shadow duration-200 h-110 cursor-default opacity-95"
                  />
                );
              } else {
                return (
                  <SummaryCard
                    key={item.data.id}
                    summary={item.data}
                    onClick={() => handleSummaryClick(item.data.id)}
                    className="hover:shadow-lg transition-shadow duration-200 h-110"
                  />
                );
              }
            })}
          </Carousel>
        </div>
      </PageContent>

      {isModalOpen && <FeedModal onClose={handleModalClose} />}
    </>
  );
}
