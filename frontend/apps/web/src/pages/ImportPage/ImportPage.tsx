import { usePageTitle } from '@ci/common';
import { Tabs } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

import { HistoryTab } from './HistoryTab';
import { ImportWizard } from './wizard/ImportWizard';

/**
 * Import an export — two surfaces over one machinery.
 *
 * The Import tab is the wizard: pick your services, export each one with the
 * instructions on the card, sync everything staged in one go. The History tab
 * is every run the appliance has done, with the live pipeline for whatever is
 * still going. They are tabs rather than one page because the wizard is a
 * flow someone walks once per archive-gathering session, while History is what
 * they come back to.
 */
export function ImportPage() {
  usePageTitle('Import - Companion Intelligence');

  return (
    <PageContent>
      <div className="space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Import</h1>
          <p className="text-muted-foreground">
            Bring in your data from the services you use — a Google Takeout, an Apple privacy download, a
            Spotify archive. Everything stays on this appliance.
          </p>
        </header>

        <Tabs defaultValue="import">
          <Tabs.List>
            <Tabs.Trigger value="import">Import</Tabs.Trigger>
            <Tabs.Trigger value="history">History</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="import" className="pt-4">
            <ImportWizard />
          </Tabs.Content>

          <Tabs.Content value="history" className="pt-4">
            <HistoryTab />
          </Tabs.Content>
        </Tabs>
      </div>
    </PageContent>
  );
}

export default ImportPage;
