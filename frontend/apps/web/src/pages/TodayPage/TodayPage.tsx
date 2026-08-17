
import { Portal, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { PageContent } from '@/components/layout';
import FeedPage from '@/pages/FeedPage';
import { SchedulePage } from '@/pages/SchedulePage';

/**
 * Your day, in one place: what is planned, then what your companion made of it.
 *
 * Schedule and Feed used to be two destinations answering halves of the same
 * question — "what is happening" and "what does it mean" — which made the
 * answer something you had to assemble by navigating. They are now one page,
 * in that order: the schedule leads because it is the part with a time on it
 * and the part you act against, and the derived material (forecast, actions,
 * questions, insights) follows because it is commentary ON the day rather than
 * the day itself.
 *
 * Composed from the two page components rather than a copy of their contents,
 * in their `embedded` variant — the same idiom `ImportSurface` uses. Each keeps
 * its own data fetching and its own standalone route; embedded, they drop the
 * chrome this page owns (breadcrumb, title, PageContent), because two of any of
 * those on one screen is two answers to "where am I", and nesting PageContent
 * nests its padding and its scroll container.
 *
 * "Today" rather than "Feed" or "Home": the page opens on a schedule that
 * already carries date navigation, so the name stays true when you page to
 * another date — it is today relative to what you are looking at — and it says
 * what you will find rather than where you are in the app.
 */
export function TodayPage() {
  usePageTitle('Today - Companion Intelligence');

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link asChild>
                <Link to="/today">Companion</Link>
              </Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Today</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>
        <SchedulePage embedded />

        {/* A rule, not a heading. The seam between "your day" and "what your
            companion noticed" needs to be visible — otherwise the forecast
            strip reads as another row of the calendar — but naming it would
            add a third piece of navigation furniture to a page that just lost
            one. */}
        <hr className="border-border" />

        <FeedPage embedded />
      </PageContent>
    </>
  );
}
