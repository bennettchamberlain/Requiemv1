import { Portal, EmptyState, usePageTitle } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';
import { Link } from 'react-router-dom';

import { InsightIcon } from '@/components/icons';

export function InsightsPage() {
  usePageTitle('Insights - Companion Intelligence');

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
              <Breadcrumb.Page>Insights</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <EmptyState icon={<InsightIcon size={48} colorized={false} />} message="No insights yet." />
    </>
  );
}
