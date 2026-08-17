import { useCallback, useState } from 'react';

import { cn } from '@ci/shadcn';

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
/** The three things the import surface can be showing. */
type Surface = 'import' | 'inbox' | 'history';

export function ImportSurface({ variant = 'page', onStageChange }: ImportSurfaceProps) {
  const [surface, setSurface] = useState<Surface>('import');
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
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {/* ONE navigation row, not two. The wizard's step buttons used to sit in
          a row of their own directly under an Import/Inbox/History tab bar —
          two bands of chrome, and the tab bar's first entry ("Import") named
          the same thing as the row beneath it ("1 Pick"). The steps ARE the
          import surface: clicking one comes back here from Inbox or History,
          and only the two destinations the steps do not name get a button.

          Deliberately NOT a Radix `Tabs`. A tablist whose selected panel has no
          trigger is malformed — Radix labels every panel `aria-labelledby` its
          trigger id, so the wizard's panel pointed at an element that had been
          removed, and assistive tech announced a tabpanel with no accessible
          name. Two toggle buttons say what this actually is.

          Onboarding shows none of it. History is meaningless on a first run —
          there are no runs to revisit — and the Inbox is the batch path for
          someone who already knows the appliance owns a folder. Offering three
          destinations before the user has imported anything is a choice asked
          too early; /sources/import carries all of it the moment setup is
          done. What is left is a single linear flow. */}
      {variant === 'page' ? (
        <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-start">
          <WizardSteps
            step={surface === 'import' ? stage : null}
            canExport={canExport}
            onStep={(next) => {
              handleStage(next);
              setSurface('import');
            }}
            className="min-w-0 flex-1"
          />

          <div
            role="group"
            aria-label="Other import views"
            className="flex shrink-0 gap-1 rounded-md bg-muted p-1 text-sm"
          >
            <SurfaceToggle
              active={surface === 'inbox'}
              onClick={() => setSurface((current) => (current === 'inbox' ? 'import' : 'inbox'))}
            >
              Inbox
            </SurfaceToggle>
            <SurfaceToggle
              active={surface === 'history'}
              onClick={() => setSurface((current) => (current === 'history' ? 'import' : 'history'))}
            >
              History
            </SurfaceToggle>
          </div>
        </div>
      ) : null}

      {/* The wizard stays MOUNTED and is hidden, never unmounted.

          Everything it holds — the services you picked, which export card you
          are on, and which runs each card has already started — lives in its
          own state. Unmounting it threw all of that away, so glancing at
          History and clicking back to Export returned you to an Export step
          with nothing in it: silent loss of work that the persistent step row
          actively invites you to risk. `hidden` costs a hidden subtree and
          keeps the work.

          overflow-hidden, not auto: the wizard scrolls itself below the row. */}
      <div className={cn('min-h-0 flex-1 overflow-hidden', surface !== 'import' && 'hidden')}>
        <ImportWizard
          step={variant === 'page' ? stage : undefined}
          onStepChange={handleStage}
          onCanExportChange={setCanExport}
        />
      </div>

      {/* Inbox and History hold nothing you can lose — both re-read the server
          on mount — so they are mounted only while shown. */}
      {variant === 'page' && surface === 'inbox' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <InboxPanel />
        </div>
      ) : null}

      {variant === 'page' && surface === 'history' ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HistoryTab />
        </div>
      ) : null}
    </div>
  );
}

function SurfaceToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      // A real toggle: pressing the one you are on returns you to the wizard,
      // which is what makes `aria-pressed` the honest state for it.
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-sm px-3 py-1.5 font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
