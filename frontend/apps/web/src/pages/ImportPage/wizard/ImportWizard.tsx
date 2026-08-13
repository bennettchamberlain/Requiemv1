import { useCallback, useEffect, useMemo, useState } from 'react';

import { cn } from '@ci/shadcn';
import { Check } from '@ci/shadcn/icons';

import { useImportApi, type CatalogSource } from '../useImportApi';

import { ExportStep } from './ExportStep';
import { PickStep } from './PickStep';
import { exportEntries } from './sources';
import { SyncStep } from './SyncStep';

type Step = 'pick' | 'export' | 'sync';

/**
 * The umbrella experience for "back up my life", in three steps:
 *
 *   1. PICK   — which platforms and services do you use?
 *   2. EXPORT — one card per pick: instructions + the upload, parse on arrival
 *   3. SYNC   — one button pushes everything staged into ci.*
 *
 * State is in-memory only. A refresh returns to Pick, and nothing is lost by
 * that: uploads became runs the moment they landed, the History tab holds
 * them, and Sync finds every unpushed run again regardless of who started it.
 */
export function ImportWizard() {
  const api = useImportApi();
  const [step, setStep] = useState<Step>('pick');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [exportIdx, setExportIdx] = useState(0);
  const [catalog, setCatalog] = useState<readonly CatalogSource[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [runsByEntry, setRunsByEntry] = useState<ReadonlyMap<string, readonly string[]>>(new Map());

  useEffect(() => {
    if (!api.ready) {
      return;
    }

    let cancelled = false;

    api
      .listCatalog()
      .then((sources) => {
        if (!cancelled) {
          setCatalog(sources);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setCatalogError(err instanceof Error ? err.message : String(err));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

  const entries = useMemo(() => exportEntries(catalog, picked), [catalog, picked]);

  const togglePicked = useCallback((key: string) => {
    setPicked((previous) => {
      const next = new Set(previous);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }, []);

  const recordRuns = useCallback((entryKey: string, runIds: readonly string[]) => {
    setRunsByEntry((previous) => {
      const next = new Map(previous);

      next.set(entryKey, [...(previous.get(entryKey) ?? []), ...runIds]);

      return next;
    });
  }, []);

  return (
    <div className="space-y-6">
      <ol className="grid gap-2 sm:grid-cols-3">
        <StepHeading
          number={1}
          title="Pick"
          caption="the platforms and services you use"
          state={step === 'pick' ? 'active' : 'done'}
          onClick={() => setStep('pick')}
        />
        <StepHeading
          number={2}
          title="Export"
          caption="your data from the sources you picked"
          state={step === 'export' ? 'active' : step === 'sync' ? 'done' : 'todo'}
          onClick={() => {
            if (picked.size > 0) {
              setExportIdx(0);
              setStep('export');
            }
          }}
        />
        <StepHeading
          number={3}
          title="Sync"
          caption="the staged data into your memory"
          state={step === 'sync' ? 'active' : 'todo'}
          onClick={() => setStep('sync')}
        />
      </ol>

      {catalogError != null && <p className="text-sm text-destructive">{catalogError}</p>}

      {step === 'pick' && (
        <PickStep
          catalog={catalog}
          picked={picked}
          onToggle={togglePicked}
          onContinue={() => {
            setExportIdx(0);
            setStep('export');
          }}
        />
      )}

      {step === 'export' && (
        <ExportStep
          entries={entries}
          index={exportIdx}
          runsByEntry={runsByEntry}
          onRunsStarted={recordRuns}
          onIndex={setExportIdx}
          onBackToPick={() => setStep('pick')}
          onFinish={() => setStep('sync')}
        />
      )}

      {step === 'sync' && <SyncStep onBackToExport={() => setStep('export')} />}
    </div>
  );
}

function StepHeading({
  number,
  title,
  caption,
  state,
  onClick,
}: {
  number: number;
  title: string;
  caption: string;
  state: 'todo' | 'active' | 'done';
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-current={state === 'active' ? 'step' : undefined}
        className={cn(
          'flex w-full items-center gap-3 rounded-md border p-3 text-left transition-colors',
          state === 'active' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-medium',
            state === 'done'
              ? 'bg-primary text-primary-foreground'
              : state === 'active'
                ? 'border-2 border-primary text-primary'
                : 'border text-muted-foreground',
          )}
        >
          {state === 'done' ? <Check className="h-4 w-4" aria-hidden /> : number}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{caption}</span>
        </span>
      </button>
    </li>
  );
}
