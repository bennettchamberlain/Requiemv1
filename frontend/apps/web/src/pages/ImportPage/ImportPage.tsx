import { usePageTitle } from '@ci/common';
import { Tabs } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

import { HistoryTab } from './HistoryTab';
import { InboxPanel } from './InboxPanel';
import { ImportWizard } from './wizard/ImportWizard';

export interface ImportSurfaceProps {
  /**
   * Where the surface is hosted. `page` is /import; `onboarding` renders the
   * same three tabs inside a dialog on the connect step, because the
   * onboarding gate bounces every main-app route back to /onboarding — the
   * surface comes to the user instead of navigating them somewhere they will
   * be bounced from. Same machinery either way; only the host differs.
   */
  variant?: 'page' | 'onboarding';
}

/**
 * The import machinery's three tabs, embeddable wherever there is a
 * bounded-height flex column to live in.
 *
 * The Import tab is the wizard: pick your services, export each one with the
 * instructions on the card, sync everything staged in one go. The Inbox tab is
 * the batch alternative — a mounted folder to move archives into, imported all
 * at once and consumed as they go. The History tab is every run the appliance
 * has done, with the live pipeline for whatever is still going. Tabs rather
 * than one page because the wizard is a flow someone walks once per
 * archive-gathering session, while Inbox and History are what they come back
 * to.
 *
 * The host must bound this component's height (PageContent does on the page;
 * a fixed-height Dialog.Content does in onboarding): the wizard pins its
 * stepper and scrolls only what sits below it, which needs a real ceiling to
 * scroll against.
 */
export function ImportSurface({ variant = 'page' }: ImportSurfaceProps) {
  return (
    <Tabs defaultValue="import" className="flex min-h-0 flex-1 flex-col">
      <Tabs.List>
        <Tabs.Trigger value="import">Import</Tabs.Trigger>
        <Tabs.Trigger value="inbox">Inbox</Tabs.Trigger>
        {/* Onboarding hides History: a first-run user has no runs to revisit,
            and the dialog is a doorway, not the archive. */}
        {variant === 'page' ? <Tabs.Trigger value="history">History</Tabs.Trigger> : null}
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

      {variant === 'page' ? (
        <Tabs.Content value="history" className="min-h-0 flex-1 overflow-y-auto pt-4">
          <HistoryTab />
        </Tabs.Content>
      ) : null}
    </Tabs>
  );
}

/** Import an export — the full-page host of {@link ImportSurface}. */
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

        <ImportSurface />
      </div>
    </PageContent>
  );
}

export default ImportPage;
