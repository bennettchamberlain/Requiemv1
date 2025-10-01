import { usePageTitle, Portal } from '@ci/common';
import { Breadcrumb } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

export function ActionsPage() {
  usePageTitle('Actions - Companion Intelligence');

  return (
    <>
      <Portal.Slot id="breadcrumbs">
        <Breadcrumb>
          <Breadcrumb.List>
            <Breadcrumb.Item className="hidden md:block">
              <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
            </Breadcrumb.Item>
            <Breadcrumb.Separator className="hidden md:block" />
            <Breadcrumb.Item>
              <Breadcrumb.Page>Actions</Breadcrumb.Page>
            </Breadcrumb.Item>
          </Breadcrumb.List>
        </Breadcrumb>
      </Portal.Slot>

      <PageContent>Placeholder</PageContent>
    </>
  );
}
