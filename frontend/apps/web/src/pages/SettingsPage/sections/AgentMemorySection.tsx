import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Badge, Button, Skeleton, cn } from '@ci/shadcn';
import { BrainCircuit, RefreshCw } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AgentNote {
  id: string;
  title: string | null;
  content: string | null;
  createdAt: string;
  processedAt: string | null;
}

type MessageType = 'info' | 'success' | 'error';

interface StatusMessage {
  text: string;
  type: MessageType;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract the bracketed source tag from a note title, e.g. "[memory]" → "memory". */
function parseSource(title: string | null): string | null {
  if (!title) {
    return null;
  }

  const match = /^\[([^\]]+)\]/.exec(title);

  return match ? match[1] : null;
}

function timeAgo(isoDate: string): string {
  const secs = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
  if (secs < 60) {
    return `${secs}s ago`;
  }

  if (secs < 3600) {
    return `${Math.floor(secs / 60)}m ago`;
  }

  if (secs < 86400) {
    return `${Math.floor(secs / 3600)}h ago`;
  }

  return `${Math.floor(secs / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// NoteRow
// ---------------------------------------------------------------------------

function NoteRow({ note }: { note: AgentNote }) {
  const source = parseSource(note.title);
  const processed = note.processedAt !== null;
  const raw = note.content ?? '';
  const preview = raw.length > 150 ? `${raw.slice(0, 150)}…` : raw;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          {source && (
            <Badge variant="secondary" className="font-mono text-xs shrink-0">
              {source}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{timeAgo(note.createdAt)}</span>
          <span
            className={cn(
              'ml-auto text-xs font-medium shrink-0',
              processed ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400',
            )}
          >
            {processed ? '✓ processed' : '○ pending'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed break-words">{preview || '—'}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function AgentMemorySection() {
  const [{ authToken }] = useAuth();
  const [notes, setNotes] = useState<AgentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [compacting, setCompacting] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback(
    () => ({
      Authorization: `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    }),
    [authToken],
  );

  const fetchNotes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await fetchJson<AgentNote[]>('/api/memory/notes', { headers: headers() });
      setNotes(data);
    } catch {
      setError('Failed to load memory fragments.');
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    void fetchNotes();
  }, [fetchNotes]);

  const handleCompact = async () => {
    try {
      setCompacting(true);
      setMessage(null);
      const result = await fetchJson<{ queued: number }>('/api/memory/compact', {
        method: 'POST',
        headers: headers(),
      });

      if (result.queued === 0) {
        setMessage({ text: 'All caught up — no fragments to compact.', type: 'success' });
      } else {
        setMessage({
          text: `Compacting ${result.queued} fragment${result.queued === 1 ? '' : 's'} in the background…`,
          type: 'info',
        });
        // Auto-refresh after the background LLM job has time to finish.
        setTimeout(() => void fetchNotes(), 8000);
      }
    } catch {
      setMessage({ text: 'Compaction failed. Is Ollama running?', type: 'error' });
    } finally {
      setCompacting(false);
    }
  };

  const pendingCount = notes.filter((n) => !n.processedAt).length;

  const messageBannerClass: Record<MessageType, string> = {
    info: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-400',
    success:
      'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400',
    error: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400',
  };

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Agent Memory</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Fragments written by your AI assistant. The compaction worker extracts entities and relationships
            from these fragments into your knowledge graph.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 mt-0.5">
          <Button variant="ghost" size="icon" onClick={() => void fetchNotes()} disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleCompact()}
            disabled={compacting || pendingCount === 0}
            className="gap-2"
          >
            <BrainCircuit className="h-4 w-4" />
            {compacting ? 'Compacting…' : pendingCount > 0 ? `Compact (${pendingCount})` : 'Compact'}
          </Button>
        </div>
      </div>

      {/* Status banner */}
      {message && (
        <div className={cn('mb-4 rounded-md border px-4 py-3 text-sm', messageBannerClass[message.type])}>
          {message.text}
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Fragment list */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
          <BrainCircuit className="h-8 w-8 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No memory fragments yet.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Fragments appear when your AI assistant writes to its memory.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </div>
      )}
    </>
  );
}
