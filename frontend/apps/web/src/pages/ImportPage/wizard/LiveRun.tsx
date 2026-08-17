import { RunPipeline } from '../RunPipeline';
import { useRunProgress } from '../useImportApi';

export interface LiveRunProps {
  runId: string;
  /** Detected services, already resolved to display titles. */
  services?: readonly string[];
}

/**
 * One run's live pipeline, self-polling.
 *
 * The wizard renders several of these at once — one per upload on an export
 * card, one per run the Sync started — and each owns its own poll so a
 * finished run goes quiet without a coordinator.
 */
export function LiveRun({ runId, services }: LiveRunProps) {
  const { run, error } = useRunProgress(runId);

  if (error != null) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  if (run == null) {
    return null;
  }

  return <RunPipeline run={run} services={services} />;
}
