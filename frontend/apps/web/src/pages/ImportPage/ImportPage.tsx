import { useCallback, useState } from 'react';

import { Tabs } from '@ci/shadcn';

import { HistoryTab } from './HistoryTab';
import { InboxPanel } from './InboxPanel';
import { ImportWizard } from './wizard/ImportWizard';
import { WizardSteps } from './wizard/WizardSteps';

export type ImportStage = 'pick' | 'export' | 'sync';

export interface ImportSurfaceProps {
  /**
   * Where the surface is hosted. `page` is the import half of /sources;
   * `onboarding` renders it inside a dialog on the connect step, because the
   * onboarding gate bounces every main-app route back to /onboarding — the
   * surface comes to the user instead of navigating them somewhere they will
   * be bounced from. Same machinery either way; only the host differs.
   */
  variant?: 'page' | 'onboarding';
  /** Told the wizard's current phase, so an onboarding host can narrate it. */
  onStageChange?: (stage: ImportStage) => void;
}

/**
 * The import machinery, embeddable wherever there is a bounded-height flex
 * column to live in — the import half of /sources, and an onboarding dialog.
 *
 * The wizard is the default surface: pick your services, export each one with
 * the instructions on the card, sync everything staged in one go. Its three
 * steps double as the navigation row, so it needs no tab of its own. Inbox is
 * the batch alternative — a mounted folder to move archives into, imported all
 * at once and consumed as they go. History is every run the appliance has done,
 * with the live pipeline for whatever is still going. Those two are tabs rather
 * than more of the page because the wizard is a flow someone walks once per
 * archive-gathering session, while Inbox and History are what they come back
 * to.
 *
 * The host must bound this component's height (PageContent does on the page;
 * a fixed-height Dialog.Content does in onboarding): the navigation row is
 * pinned and only what sits below it scrolls, which needs a real ceiling to
 * scroll against.
 */
export function ImportSurface({ variant = 'page', onStageChange }: ImportSurfaceProps) {
  const [tab, setTab] = useState('import');
  const [stage, setStage] = useState<ImportStage>('pick');
  const [canExport, setCanExport] = useState(false);

  const handleStage = useCallback(
    (next: ImportStage) => {
      setStage(next);
      onStageChange?.(next);
    },
    [onStageChange],
  );

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ONE navigation row, not two. The wizard's step buttons used to sit in
          a row of their own directly under an Import/Inbox/History tab bar —
          two bands of chrome, and the tab bar's first entry ("Import") named
          the same thing as the row beneath it ("1 Pick"). The steps ARE the
          import tab now: clicking one comes back here from Inbox or History,
          and the tab bar keeps only the two destinations the steps do not name.

          Onboarding shows none of it. History is meaningless on a first run —
          there are no runs to revisit — and the Inbox is the batch path for
          someone who already knows the appliance owns a folder. Offering three
          destinations before the user has imported anything is a choice asked
          too early; /sources/import carries all of it the moment setup is
          done. What is left is a single linear flow. */}
      {variant === 'page' ? (
        <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-start">
          <WizardSteps
            step={tab === 'import' ? stage : null}
            canExport={canExport}
            onStep={(next) => {
              handleStage(next);
              setTab('import');
            }}
            className="min-w-0 flex-1"
          />

          <Tabs.List className="shrink-0 lg:h-auto lg:self-stretch">
            <Tabs.Trigger value="inbox">Inbox</Tabs.Trigger>
            <Tabs.Trigger value="history">History</Tabs.Trigger>
          </Tabs.List>
        </div>
      ) : null}

      {/* overflow-hidden, not auto: the wizard scrolls itself below the row.
          Inbox and History have no pinned part, so they scroll whole. */}
      <Tabs.Content value="import" className="min-h-0 flex-1 overflow-hidden">
        <ImportWizard
          step={variant === 'page' ? stage : undefined}
          onStepChange={handleStage}
          onCanExportChange={setCanExport}
        />
      </Tabs.Content>

      {variant === 'page' ? (
        <Tabs.Content value="inbox" className="min-h-0 flex-1 overflow-y-auto">
          <InboxPanel />
        </Tabs.Content>
      ) : null}

      {variant === 'page' ? (
        <Tabs.Content value="history" className="min-h-0 flex-1 overflow-y-auto">
          <HistoryTab />
        </Tabs.Content>
      ) : null}
    </Tabs>
  );
}
