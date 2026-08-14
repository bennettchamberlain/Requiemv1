import { usePageTitle } from '@ci/common';
import { Tabs } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

import { HistoryTab } from './HistoryTab';
import { InboxPanel } from './InboxPanel';
import { ImportWizard } from './wizard/ImportWizard';

/**
 * Import an export — three surfaces over one machinery.
 *
 * The Import tab is the wizard: pick your services, export each one with the
 * instructions on the card, sync everything staged in one go. The Inbox tab is
 * the batch alternative — a mounted folder to move archives into, imported all
 * at once and consumed as they go. The History tab is every run the appliance
 * has done, with the live pipeline for whatever is still going. Tabs rather
 * than one page because the wizard is a flow someone walks once per
 * archive-gathering session, while Inbox and History are what they come back
 * to.
 */
export function ImportPage() {
  usePageTitle('Import - Companion Intelligence');

  return (
    // The header, tab bar and (inside the wizard) the step indicators stay
    // pinned; only what sits BELOW them scrolls, in its own region. Two
    // things fall out of that. The stepper stays in view however long the
    // service list gets. And the outer PageContent never overflows, so its
    // classic scrollbar — whose appearance used to steal ~15px of width and
    // visibly resize the step headers every time the Pick facet swapped a
    // ~100-service list for a short one — never exists to begin with.
    <PageContent>
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Import</h1>
          <p className="text-muted-foreground">
            Bring in your data from the services you use — a Google Takeout, an Apple privacy download, a
            Spotify archive. Everything stays on this appliance.
          </p>
        </header>

        <Tabs defaultValue="import" className="flex min-h-0 flex-1 flex-col">
          <Tabs.List>
            <Tabs.Trigger value="import">Import</Tabs.Trigger>
            <Tabs.Trigger value="inbox">Inbox</Tabs.Trigger>
            <Tabs.Trigger value="history">History</Tabs.Trigger>
          </Tabs.List>

          {/* overflow-hidden, not auto: the wizard scrolls itself below its
              stepper. Inbox and History have no pinned part, so they scroll
              whole. */}
          <Tabs.Content value="import" className="min-h-0 flex-1 overflow-hidden pt-4">
            <ImportWizard />
          </Tabs.Content>

          <Tabs.Content value="inbox" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <InboxPanel />
          </Tabs.Content>

          <Tabs.Content value="history" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <HistoryTab />
          </Tabs.Content>
        </Tabs>
      </div>
    </PageContent>
  );
}

export default ImportPage;
