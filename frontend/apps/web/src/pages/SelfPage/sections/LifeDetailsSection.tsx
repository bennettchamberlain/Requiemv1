import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Input, Textarea, ToggleGroup } from '@ci/shadcn';
import { Loader2, NotebookPen } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';
import type { CataloguePage } from '@/pages/PromptsPage/catalogue';

import { curatedCatalogueUrl, LIFE_DETAIL_THEMES, type CuratedAnswers, type CuratedQuestion } from './lifeDetails';

/** Debounce between the last keystroke and a question row autosaving. */
const ANSWER_AUTOSAVE_DEBOUNCE_MS = 900;

/**
 * One theme's worth of curated questions, each rendered by type: button
 * options as a ToggleGroup (saves immediately on click), a narrative-tier
 * open question as a compact Textarea, everything else as a single-line
 * Input — both text controls autosave a fixed delay after the last
 * keystroke, matching the identity form above.
 */
function QuestionRow({
  question,
  answer,
  draft,
  busy,
  onDraftChange,
  onAnswer,
}: {
  question: CuratedQuestion;
  answer: string | null;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onAnswer: (text: string) => void;
}) {
  // Fires only for the free-text branches below (yes_no/multiple_choice
  // buttons already save on click, before this could ever run).
  useEffect(() => {
    if (busy || draft.trim().length === 0) {
      return;
    }

    const timer = setTimeout(() => onAnswer(draft), ANSWER_AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `onAnswer`/`busy` deliberately excluded: both are recreated by the parent
    // on every keystroke in ANY row (shared `drafts` state), so including them
    // would reset this row's debounce on unrelated sibling edits.
  }, [draft]);

  if (answer) {
    return (
      <p className="truncate py-1.5 text-sm">
        <span className="text-muted-foreground">{question.text}:</span>{' '}
        <span className="text-foreground/90">{answer}</span>
      </p>
    );
  }

  if (question.options) {
    return (
      <div className="flex flex-col gap-1.5 py-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
        <span className="text-sm sm:min-w-0 sm:flex-1">{question.text}</span>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          className="w-full justify-start sm:w-auto sm:shrink-0"
          onValueChange={(value) => value && onAnswer(value)}
        >
          {question.options.map((option) => (
            <ToggleGroup.Item key={option} value={option} className="px-3 text-xs" disabled={busy}>
              {option}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup>
      </div>
    );
  }

  if (question.tier === 'narrative') {
    return (
      <div className="py-1.5">
        <p className="mb-1 text-sm">{question.text}</p>
        <div className="flex items-center gap-2">
          <Textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            rows={2}
            placeholder="Your answer…"
            className="min-h-0 flex-1 text-sm"
          />
          {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.5} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 py-1.5 sm:flex-row sm:items-center sm:gap-2">
      <span className="text-sm sm:min-w-0 sm:flex-1">{question.text}</span>
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Answer…"
        className="h-8 w-full min-w-0 text-sm sm:max-w-80 sm:shrink-0"
      />
      {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.5} />}
    </div>
  );
}

/** A fixed, hand-curated slice of your Reflections answers — see lifeDetails.ts for why these questions and not a generic category browse. */
export function LifeDetailsSection() {
  const [{ authToken }] = useAuth();
  const [answers, setAnswers] = useState<CuratedAnswers>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  const loadAnswers = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchJson<CataloguePage>(curatedCatalogueUrl(), {
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      });
      const byId: CuratedAnswers = {};
      for (const entry of page?.data ?? []) {
        byId[entry.id] = entry.answer;
      }

      setAnswers(byId);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void loadAnswers();
  }, [loadAnswers]);

  const handleAnswer = async (questionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || submittingId) {
      return;
    }

    setSubmittingId(questionId);
    try {
      await fetchJson('/api/answers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ text: trimmed, question: { id: questionId } }),
      });
      setDrafts((prev) => ({ ...prev, [questionId]: '' }));
      await loadAnswers();
    } catch {
      // Draft (if any) survives on failure so the user doesn't retype it.
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
        <h2 className="text-lg font-semibold">Life details</h2>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-muted-foreground">Couldn&apos;t load this section.</p>}

      {!loading && !error && (
        <div className="flex flex-col gap-4">
          {LIFE_DETAIL_THEMES.map((theme) => (
            <div key={theme.key}>
              <h3 className="mb-1 text-sm font-medium">{theme.label}</h3>
              <div className="divide-y divide-border/60">
                {theme.questions.map((question) => (
                  <QuestionRow
                    key={question.id}
                    question={question}
                    answer={answers[question.id]?.text ?? null}
                    draft={drafts[question.id] ?? ''}
                    busy={submittingId === question.id}
                    onDraftChange={(value) => setDrafts((prev) => ({ ...prev, [question.id]: value }))}
                    onAnswer={(text) => void handleAnswer(question.id, text)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
