import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

/**
 * The import API, as the UI consumes it.
 *
 * Mirrors what `ImportRunsController` and `ImportUploadsController` return. The
 * shapes are restated here rather than imported from the backend because the two
 * are separate build graphs; the tests below are what keep them honest.
 */

export interface ImportSource {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  /** Recognized but not implemented. Shown, so a search for it does not read as "unsupported". */
  readonly stub: boolean;
  readonly supportsFiles: boolean;
  readonly supportsApi: boolean;
  /** How to obtain this export. Null when nobody has authored a guide yet. */
  readonly guide: ImportSourceGuide | null;
}

/** Authored instructions for getting one export out of the service that holds it. */
export interface ImportSourceGuide {
  readonly title: string;
  readonly blurb: string;
  readonly ecosystem: string;
  readonly category: string;
  readonly wait: string;
  /** How the export is obtained: web-export, app-export, local-file, manual-upload, api. */
  readonly acquisition?: string;
  readonly url?: string;
  readonly stepsTitle?: string;
  readonly steps: readonly string[];
  readonly altPath?: { readonly title: string; readonly url?: string; readonly steps: readonly string[] };
  readonly expectedFormat?: string;
  readonly whatImported?: readonly string[];
  readonly caveats?: readonly string[];
  /** Loose addenda, rendered without a heading. */
  readonly notes?: readonly string[];
}

/**
 * One authored source from `GET /import/sources/catalog` — the wizard's unit.
 *
 * SOURCE-keyed where {@link ImportSource} is importer-keyed: services sharing
 * one parser each get an entry, and a service whose importer is not written
 * yet arrives with `importerReady: false` instead of being invisible. The
 * array order is curated server-side (tier then ecosystem) — never re-sort it.
 */
export interface CatalogSource {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly ecosystem: string;
  readonly category: string;
  readonly acquisition: string;
  readonly wait: string;
  readonly url?: string;
  readonly stepsTitle?: string;
  readonly steps: readonly string[];
  readonly altPath?: { readonly title: string; readonly url?: string; readonly steps: readonly string[] };
  readonly expectedFormat?: string;
  readonly whatImported?: readonly string[];
  readonly caveats?: readonly string[];
  readonly notes?: readonly string[];
  /** Effective importer name — what a run's detected `dataSources` records. */
  readonly importer: string;
  readonly importerReady: boolean;
}

export interface ImportStage {
  readonly id: string;
  readonly seq: number;
  readonly kind: string;
  readonly status: string;
  readonly phase: string | null;
  readonly processed: number;
  /** Null means the work is not yet countable — draw an indeterminate bar, never 0%. */
  readonly total: number | null;
  readonly weight: number;
  readonly etaSeconds: number | null;
  readonly durationMs: number | null;
  readonly error: string | null;
  readonly detail: Record<string, unknown>;
}

export interface ImportRun {
  readonly id: string;
  readonly label: string | null;
  readonly source: string;
  /**
   * The services the archive turned out to contain, most rows first. Empty
   * until the run has parsed.
   */
  readonly dataSources: readonly string[];
  /**
   * The importer(s) the user's service card stood for when the run started —
   * null when nothing was declared (inbox, CLI, older runs). What makes the
   * picker's "imported ✓" a claim about intent, not stray recognition.
   */
  readonly declaredSources?: readonly string[] | null;
  readonly status: string;
  readonly percent: number;
  readonly requestedStages: readonly string[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  /**
   * Records this run pushed into `ci.*`. Sent on the LIST only — the detail
   * endpoint carries the same number spread across its stages.
   */
  readonly records?: number;
}

export interface ImportRunDetail extends ImportRun {
  readonly stages: readonly ImportStage[];
}

export interface StagedDrop {
  readonly dropId: string;
  readonly originalFilename: string | null;
  readonly sizeBytes: number | null;
  readonly status: string;
  readonly expiresAt: string | null;
}

/** A run whose parsed rows are waiting for a push — what the Sync card lists. */
export interface UnpushedRun extends ImportRun {
  readonly pendingItems: number;
  readonly pendingEntities: number;
}

/** One importable thing the inbox scan found — a file, or a whole recognized directory. */
export interface InboxUnit {
  /** Path relative to the inbox folder — the handle importInbox takes. */
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly sizeBytes: number;
  readonly fileCount: number;
  readonly recognized: readonly { dataSource: string; title: string; confidence: number }[];
  /** An unfinished run of THIS user's already consuming the unit, if any. */
  readonly activeRunId: string | null;
  /**
   * Some run holds this unit, whoever started it. The inbox is one folder
   * shared by every account, so this — not `activeRunId` — is what says a unit
   * cannot be imported. Another user's run id is never exposed.
   */
  readonly claimed: boolean;
}

export interface InboxScan {
  readonly available: boolean;
  readonly reason?: string;
  readonly inboxDir: string;
  readonly units: readonly InboxUnit[];
  readonly skippedSymlinks: number;
  readonly truncated: boolean;
}

export interface InboxUnitResult {
  readonly unit: string;
  readonly runId?: string;
  readonly label?: string;
  readonly error?: string;
}

/** A run is done when the server says so — these are the terminal statuses. */
export const TERMINAL_RUN_STATUSES = new Set(['completed', 'partial', 'failed', 'cancelled']);

export function isRunFinished(run: Pick<ImportRun, 'status'> | null | undefined): boolean {
  return run != null && TERMINAL_RUN_STATUSES.has(run.status);
}

/**
 * Every call the import UI makes, in one place.
 *
 * The upload is deliberately NOT `fetchJson`: it posts multipart FormData, and a
 * JSON helper that sets Content-Type would break the boundary the browser has to
 * generate itself.
 */
export function useImportApi() {
  const [{ authToken }] = useAuth();

  /**
   * The CURRENT token, readable from long-lived closures.
   *
   * `useAutoRefreshToken` rotates the session JWT on a schedule, and the
   * upload loop in ExportStep runs for hours inside one closure — with the
   * token captured directly, every file after a rotation was sent with the
   * dead token and failed "Unauthorized" for the rest of the batch. Routing
   * every request's header through this ref means even a stale closure signs
   * with whatever token is live at SEND time. It also makes `authHeaders` —
   * and therefore the whole returned api object — referentially stable across
   * rotations, so consumers keyed on it stop refetching for no reason.
   */
  const tokenRef = useRef(authToken);

  useEffect(() => {
    tokenRef.current = authToken;
  }, [authToken]);

  const authHeaders = useCallback(() => ({ Authorization: `Bearer ${tokenRef.current ?? ''}` }), []);

  const listSources = useCallback(
    async (): Promise<ImportSource[]> =>
      (await fetchJson<ImportSource[]>('/api/import/sources', { headers: authHeaders() })) ?? [],
    [authHeaders],
  );

  const listCatalog = useCallback(
    async (): Promise<CatalogSource[]> =>
      (await fetchJson<CatalogSource[]>('/api/import/sources/catalog', { headers: authHeaders() })) ?? [],
    [authHeaders],
  );

  const listRuns = useCallback(
    async (limit?: number, before?: { createdAt: string; id: string }): Promise<ImportRun[]> => {
      // Keyset cursor — the last run of the page already shown. See the
      // endpoint: pages chain by (createdAt, id), immune to runs created
      // while history is being read.
      const params = new URLSearchParams();

      if (limit != null) {
        params.set('limit', String(limit));
      }

      if (before != null) {
        params.set('beforeCreatedAt', before.createdAt);
        params.set('beforeId', before.id);
      }

      const query = params.toString();

      return (
        (await fetchJson<ImportRun[]>(`/api/import/runs${query.length > 0 ? `?${query}` : ''}`, {
          headers: authHeaders(),
        })) ?? []
      );
    },
    [authHeaders],
  );

  const listUnpushed = useCallback(
    async (): Promise<UnpushedRun[]> =>
      (await fetchJson<UnpushedRun[]>('/api/import/runs/unpushed', { headers: authHeaders() })) ?? [],
    [authHeaders],
  );

  const getRun = useCallback(
    async (runId: string): Promise<ImportRunDetail | null> =>
      (await fetchJson<ImportRunDetail>(`/api/import/runs/${runId}`, { headers: authHeaders() })) ?? null,
    [authHeaders],
  );

  /**
   * Upload ONE archive, reporting byte progress as it goes.
   *
   * `XMLHttpRequest` rather than `fetch`, because fetch has no upload-progress
   * events — and for a multi-hundred-GB Takeout part, the difference between a
   * static "Uploading…" and a moving byte count is whether the person believes
   * anything is happening. No explicit Content-Type either way: the browser
   * must generate the multipart boundary itself.
   *
   * One file per request on purpose (this replaced a single POST carrying every
   * file): a failure costs one archive instead of the whole batch, progress is
   * attributable to a file, and the caller can start the finished drop's
   * unpack+parse run while the next file is still uploading.
   */
  const uploadFile = useCallback(
    (file: File, onProgress?: (loadedBytes: number, totalBytes: number) => void): Promise<StagedDrop> =>
      new Promise<StagedDrop>((resolve, reject) => {
        const form = new FormData();

        form.append('files', file);

        const xhr = new XMLHttpRequest();

        xhr.open('POST', '/api/import/uploads');

        for (const [name, value] of Object.entries(authHeaders())) {
          xhr.setRequestHeader(name, value);
        }

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            onProgress?.(event.loaded, event.total);
          }
        };

        xhr.onerror = () => reject(new Error('Upload failed: network error'));
        xhr.ontimeout = () => reject(new Error('Upload failed: timed out'));

        xhr.onload = () => {
          if (xhr.status < 200 || xhr.status >= 300) {
            // The same message extraction as describeFailure, over the XHR shape.
            let message = `Upload failed (${xhr.status})`;

            try {
              const body = JSON.parse(xhr.responseText) as { message?: string | string[] };
              const detail = Array.isArray(body.message) ? body.message.join(', ') : body.message;

              if (detail) {
                message = detail;
              }
            } catch {
              // Not JSON — keep the status-code fallback.
            }

            reject(new Error(message));

            return;
          }

          try {
            // The endpoint answers one staged drop per file; this request
            // carried exactly one.
            const [drop] = JSON.parse(xhr.responseText) as StagedDrop[];

            if (drop == null) {
              reject(new Error('Nothing was uploaded'));

              return;
            }

            resolve(drop);
          } catch (err: unknown) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        };

        xhr.send(form);
      }),
    [authHeaders],
  );

  /**
   * Upload one unzipped folder as a single drop.
   *
   * Each file is sent with its `webkitRelativePath` so the API can rebuild the
   * tree. One drop, one run — the same unit the inbox uses for a directory.
   * (The wizard prefers packing a folder into one zip client-side; this is the
   * no-zip fallback path and stays a single request.)
   */
  const uploadFolder = useCallback(
    async (files: readonly File[]): Promise<StagedDrop[]> => {
      const form = new FormData();

      for (const file of files) {
        form.append('files', file);
        form.append('paths', file.webkitRelativePath || file.name);
      }

      const response = await postUpload(form, authHeaders());

      return (await response.json()) as StagedDrop[];
    },
    [authHeaders],
  );

  const startRun = useCallback(
    async (
      dropId: string,
      options: { label?: string; stages?: readonly string[]; declaredSources?: readonly string[] } = {},
    ) =>
      post<ImportRunDetail>('/api/import/runs', authHeaders(), {
        dropId,
        label: options.label,
        stages: options.stages,
        declaredSources: options.declaredSources,
      }),
    [authHeaders],
  );

  /**
   * The Sync click: append a push to every unpushed run (or the named ones)
   * and set them going. Progress after this is the ordinary run poll.
   */
  const startPush = useCallback(
    async (runIds?: readonly string[]) =>
      post<{ runs: ImportRun[] }>('/api/import/push', authHeaders(), {
        runIds: runIds == null ? undefined : [...runIds],
      }),
    [authHeaders],
  );

  const cancelRun = useCallback(
    async (runId: string) =>
      post<{ cancelled: boolean }>(`/api/import/runs/${runId}/cancel`, authHeaders(), {}),
    [authHeaders],
  );

  /** What is waiting in the appliance's inbox folder. */
  const scanInbox = useCallback(
    async (): Promise<InboxScan | null> =>
      (await fetchJson<InboxScan>('/api/import/inbox', { headers: authHeaders() })) ?? null,
    [authHeaders],
  );

  /**
   * Start one run per inbox unit. Omit `units` to import everything the scan
   * yields that is not already running. Per-unit failures ride in the results
   * rather than failing the batch.
   */
  const importInbox = useCallback(
    async (units?: readonly string[]) =>
      post<{ results: InboxUnitResult[] }>('/api/import/inbox/runs', authHeaders(), {
        units: units == null ? undefined : [...units],
      }),
    [authHeaders],
  );

  const retryStage = useCallback(
    async (runId: string, stageId: string) =>
      post<{ requeued: boolean }>(`/api/import/runs/${runId}/stages/${stageId}/retry`, authHeaders(), {}),
    [authHeaders],
  );

  /**
   * Push the rows a completed push could not write.
   *
   * Distinct from `retryStage`, which re-runs a stage that FAILED. A push that
   * mostly worked completes, and its casualties sit at `failed` where nothing
   * looks at them again — this is the only way back for them.
   */
  const retryFailedPush = useCallback(
    async (runId: string) =>
      post<{ items: number; entities: number; requeued: boolean }>(
        `/api/import/runs/${runId}/push/retry`,
        authHeaders(),
        {},
      ),
    [authHeaders],
  );

  // Memoized, and it has to be. Every call below is already a stable
  // `useCallback`, but a fresh object literal here is a new reference on every
  // render — and a caller with `[api]` in an effect then re-runs that effect on
  // every render, sets state, re-renders, and fetches again. The page did
  // exactly that: /import/sources and /import/runs on a loop, as fast as the
  // responses came back.
  return useMemo(
    () => ({
      ready: Boolean(authToken),
      listSources,
      listCatalog,
      listRuns,
      listUnpushed,
      getRun,
      uploadFile,
      uploadFolder,
      startRun,
      startPush,
      cancelRun,
      retryStage,
      retryFailedPush,
      scanInbox,
      importInbox,
    }),
    [
      authToken,
      listSources,
      listCatalog,
      listRuns,
      listUnpushed,
      getRun,
      uploadFile,
      uploadFolder,
      startRun,
      startPush,
      cancelRun,
      retryStage,
      retryFailedPush,
      scanInbox,
      importInbox,
    ],
  );
}

/**
 * Poll one run until it reaches a terminal status.
 *
 * The interval stops on its own when the run finishes, rather than polling a
 * completed import forever — this page is left open while a 40GB Takeout runs,
 * and it should go quiet when there is nothing left to say.
 */
export function useRunProgress(runId: string | null, intervalMs = 2_000) {
  const { getRun, ready } = useImportApi();
  const [run, setRun] = useState<ImportRunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isInitialLoad = useRef(true);

  const load = useCallback(async () => {
    if (!ready || runId == null) {
      return;
    }

    try {
      setRun(await getRun(runId));
      setError(null);
      isInitialLoad.current = false;
    } catch (err: unknown) {
      // Only the first failure is worth showing: a blip mid-import should not
      // replace a progress bar someone is watching with an error banner.
      if (isInitialLoad.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [getRun, ready, runId]);

  useEffect(() => {
    // Clearing on a null id is the whole point of a null id. Without this the
    // last run stayed in state after it was deselected, so closing an opened
    // import called its handler, set the id to null, and changed nothing on
    // screen — the page still had a run to render.
    if (runId == null) {
      setRun(null);
      setError(null);

      return;
    }

    if (!ready) {
      return;
    }

    isInitialLoad.current = true;
    void load();
  }, [load, ready, runId]);

  useEffect(() => {
    if (!ready || runId == null || isRunFinished(run)) {
      return;
    }

    const handle = window.setInterval(() => void load(), intervalMs);

    return () => window.clearInterval(handle);
  }, [intervalMs, load, ready, run, runId]);

  return { run, error, refresh: load } as const;
}

/**
 * Shared progress for MANY runs: one runs-list poll feeds every card.
 *
 * The wizard used to mount one {@link useRunProgress} per run — reasonable at
 * three uploads, a self-inflicted flood at a Takeout's 140: each card polled
 * the detail endpoint every two seconds and re-rendered on its own clock,
 * which pegged the tab's renderer (and, Chrome sharing renderer processes
 * same-site, every other tab of the app with it). This hook makes it ONE
 * request per tick regardless of run count, and it stops itself once every
 * watched run is finished.
 *
 * Returns summaries (no stages) — enough to say finished/failed/percent per
 * run. The handful of runs still ACTIVE keep their detailed per-run poll via
 * `LiveRun`; with parsing single-file that is one or two, not a hundred.
 *
 * `GET /import/runs` caps at 200, newest first; a watched id beyond that page
 * simply stays unknown and its card falls back to the detailed poll.
 */
export function useRunsProgress(
  runIds: readonly string[],
  intervalMs = 2_000,
): ReadonlyMap<string, ImportRun> {
  const { listRuns, ready } = useImportApi();
  const [runs, setRuns] = useState<ReadonlyMap<string, ImportRun>>(new Map());
  // The ids as a value, so a parent re-render with a fresh (but equal) array
  // does not restart the poll.
  const idsKey = runIds.join(',');

  useEffect(() => {
    const ids = idsKey.length === 0 ? [] : idsKey.split(',');

    if (!ready || ids.length === 0) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const page = await listRuns(200);

        if (cancelled) {
          return;
        }

        const wanted = new Set(ids);
        const next = new Map(page.filter((run) => wanted.has(run.id)).map((run) => [run.id, run]));

        setRuns(next);

        const allFinished = ids.every((id) => isRunFinished(next.get(id)));

        if (!allFinished) {
          timer = window.setTimeout(() => void tick(), intervalMs);
        }
      } catch {
        // A blip mid-import must not kill the poll; try again next tick.
        if (!cancelled) {
          timer = window.setTimeout(() => void tick(), intervalMs);
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [idsKey, intervalMs, listRuns, ready]);

  return runs;
}

async function post<T>(url: string, headers: Record<string, string>, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(await describeFailure(response, 'Request failed'));
  }

  return (await response.json()) as T;
}

/**
 * The server's own explanation when it gave one.
 *
 * The import API says useful things — "not enough disk space to unpack", "this
 * upload has already been claimed" — and replacing them with a status code
 * throws away the only actionable part.
 */
async function postUpload(form: FormData, headers: Record<string, string>): Promise<Response> {
  let response: Response;

  try {
    response = await fetch('/api/import/uploads', {
      method: 'POST',
      headers,
      body: form,
    });
  } catch {
    throw new Error(
      'Could not reach the appliance. If you dropped a folder, use Choose folder — or upload the .zip.',
    );
  }

  if (!response.ok) {
    throw new Error(await describeFailure(response, 'Upload failed'));
  }

  return response;
}

async function describeFailure(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message;

    return message || `${fallback} (${response.status})`;
  } catch {
    return `${fallback} (${response.status})`;
  }
}
