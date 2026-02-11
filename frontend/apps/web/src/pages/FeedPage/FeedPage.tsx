import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';

import { GlobalUID, ErrorPage, LoadingPage, Portal, useDeviceLayout, usePageTitle } from '@ci/common';
import { Breadcrumb, cn } from '@ci/shadcn';
import { useNavigate, useParams, Link } from 'react-router-dom';

import { useActionListService } from '@/api';
import { PageContent } from '@/components/layout';
import { Markdown } from '@/components/Markdown';
import { type FragmentType } from '@/graphql';
import { useModalControls } from '@/hooks';

import { BentoCard } from '../../components/BentoCard';
import { Carousel } from '../../components/Carousel';

import { FeedModal } from './FeedModal';
import type { INSIGHT_CARD_FRAGMENT } from './InsightCard';
import { InsightCard } from './InsightCard';
import type { SUMMARY_CARD_FRAGMENT } from './SummaryCard';
import { SummaryCard } from './SummaryCard';
import { useSummariesService } from './useSummariesService';

type CarouselProps = Partial<ComponentProps<typeof Carousel>>;
const DISMISSED_INSIGHTS_STORAGE_KEY = 'feed:dismissed-insights:v1';

export function FeedPage() {
  usePageTitle('Feed - Companion Intelligence');

  const { isMobile } = useDeviceLayout();
  const navigate = useNavigate();

  const { id: actionId } = useParams<{ id?: string }>();
  const [{ data: actions, loading, error }, { markActionAsSeen }] = useActionListService(5);
  const [{ data: summaries, loading: summariesLoading, error: summariesError }, { markSummaryAsSeen }] =
    useSummariesService(10);
  const [dismissedActionIds, setDismissedActionIds] = useState<Set<string>>(new Set());
  const [dismissedSummaryIds, setDismissedSummaryIds] = useState<Set<string>>(new Set());
  const [dismissedInsightIds, setDismissedInsightIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_INSIGHTS_STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      setDismissedInsightIds(new Set(parsed.filter((value): value is string => typeof value === 'string')));
    } catch {
      setDismissedInsightIds(new Set());
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(DISMISSED_INSIGHTS_STORAGE_KEY, JSON.stringify(Array.from(dismissedInsightIds)));
  }, [dismissedInsightIds]);

  const visibleActions = useMemo(
    () => actions.filter((action) => !action.seen && !dismissedActionIds.has(action.id)),
    [actions, dismissedActionIds],
  );
  const visibleSummaries = useMemo(
    () => summaries.filter((summary) => !summary.seen && !dismissedSummaryIds.has(summary.id)),
    [summaries, dismissedSummaryIds],
  );
  const visibleInsights = useMemo(
    () =>
      visibleSummaries.flatMap((summary) =>
        summary.insights
          .map((insight, idx) => ({
            id: `${summary.id}:${idx}`,
            summaryId: summary.id,
            insight,
          }))
          .filter((item) => !dismissedInsightIds.has(item.id)),
      ),
    [dismissedInsightIds, visibleSummaries],
  );
  const mixedInsightSummaryCards = useMemo(() => {
    const mixed: Array<
      | {
          kind: 'insight';
          id: string;
          insightId: string;
          summaryId: string;
          insight: (typeof visibleInsights)[number]['insight'];
        }
      | {
          kind: 'summary';
          id: string;
          summary: (typeof visibleSummaries)[number];
        }
    > = [];
    const max = Math.max(visibleInsights.length, visibleSummaries.length);

    for (let index = 0; index < max; index += 1) {
      const insight = visibleInsights[index];
      if (insight) {
        mixed.push({
          kind: 'insight',
          id: `insight:${insight.id}`,
          insightId: insight.id,
          summaryId: insight.summaryId,
          insight: insight.insight,
        });
      }

      const summary = visibleSummaries[index];
      if (summary) {
        mixed.push({
          kind: 'summary',
          id: `summary:${summary.id}`,
          summary,
        });
      }
    }

    return mixed;
  }, [visibleInsights, visibleSummaries]);

  const selectedActionIndex = useMemo(
    () => visibleActions.findIndex((item) => item.id === actionId),
    [visibleActions, actionId],
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
  }, [closeModal, openModal, selectedActionIndex]);

  const handleCardClick = useCallback(
    (id: string) => {
      navigate(`/feed/${id}`, { replace: true });
      openModal();
      // Mark action as seen when clicked
      markActionAsSeen(id);
    },
    [navigate, openModal, markActionAsSeen],
  );

  const handleActionDismiss = useCallback(
    async (id: string) => {
      setDismissedActionIds((prev) => new Set(prev).add(id));

      if (actionId === id) {
        navigate('/feed', { replace: true });
      }

      await markActionAsSeen(id);
    },
    [actionId, markActionAsSeen, navigate],
  );

  const handleSummaryDismiss = useCallback(
    async (id: string) => {
      setDismissedSummaryIds((prev) => new Set(prev).add(id));
      await markSummaryAsSeen(id);
    },
    [markSummaryAsSeen],
  );

  const handleInsightDismiss = useCallback(
    async (insightId: string, summaryId: string) => {
      setDismissedInsightIds((prev) => new Set(prev).add(insightId));
      await markSummaryAsSeen(summaryId);
    },
    [markSummaryAsSeen],
  );

  const handleModalClose = useCallback(() => {
    navigate('/feed', { replace: true });
    closeModal();
  }, [navigate, closeModal]);

  const handleSummaryClick = useCallback(
    (encodedId: string) => {
      navigate(`/insights/${GlobalUID.parse('summary', encodedId)}`);
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
            visibleActions.map((action) => (
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
                onDismiss={() => void handleActionDismiss(action.id)}
                dismissLabel="Dismiss action"
                className={cn(!action.seen && 'ring-2 ring-primary/40')}
              />
            ))}

          {mixedInsightSummaryCards.map((card) =>
            card.kind === 'insight' ? (
              <InsightCard
                key={card.id}
                insight={card.insight as FragmentType<typeof INSIGHT_CARD_FRAGMENT>}
                onDismiss={() => void handleInsightDismiss(card.insightId, card.summaryId)}
              />
            ) : (
              <SummaryCard
                key={card.id}
                summary={card.summary as FragmentType<typeof SUMMARY_CARD_FRAGMENT>}
                onClick={() => handleSummaryClick(card.summary.id)}
                onDismiss={() => void handleSummaryDismiss(card.summary.id)}
              />
            ),
          )}
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
            visibleActions.map((action) => (
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
                onDismiss={() => void handleActionDismiss(action.id)}
                dismissLabel="Dismiss action"
                className={cn(
                  'hover:shadow-lg transition-shadow duration-200',
                  !action.seen && 'ring-2 ring-primary/40',
                )}
              />
            ))}
        </Carousel>

        <h2 className="text-2xl font-bold text-foreground">Insights & Summaries</h2>

        <div className="space-y-3">
          {(summariesLoading || summariesError) && (
            <div className={cn('text-sm', summariesError ? 'text-destructive' : 'text-muted-foreground')}>
              {summariesLoading
                ? 'Fetching your personalized insights...'
                : 'We could not load live insights. Preview cards are shown until the service recovers.'}
            </div>
          )}

          <Carousel {...carouselProps}>
            {mixedInsightSummaryCards.map((card) =>
              card.kind === 'insight' ? (
                <InsightCard
                  key={card.id}
                  insight={card.insight as FragmentType<typeof INSIGHT_CARD_FRAGMENT>}
                  onDismiss={() => void handleInsightDismiss(card.insightId, card.summaryId)}
                  className="hover:shadow-lg transition-shadow duration-200 h-110"
                />
              ) : (
                <SummaryCard
                  key={card.id}
                  summary={card.summary as FragmentType<typeof SUMMARY_CARD_FRAGMENT>}
                  onClick={() => handleSummaryClick(card.summary.id)}
                  onDismiss={() => void handleSummaryDismiss(card.summary.id)}
                  className="hover:shadow-lg transition-shadow duration-200 h-110"
                />
              ),
            )}
          </Carousel>
        </div>
      </PageContent>

      {isModalOpen && <FeedModal onClose={handleModalClose} />}
    </>
  );
}
