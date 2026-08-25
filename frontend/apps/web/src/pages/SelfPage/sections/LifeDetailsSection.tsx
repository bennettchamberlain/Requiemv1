import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Input, Textarea, ToggleGroup } from '@ci/shadcn';
import { Loader2, NotebookPen } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';
import type { CataloguePage } from '@/pages/PromptsPage/catalogue';

import {
  curatedCatalogueUrl,
  indexCuratedAnswers,
  LIFE_DETAIL_THEMES,
  type CuratedAnswers,
  type CuratedQuestion,
} from './lifeDetails';

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
      <div className="flex flex-wrap items-center justify-between gap-2 py-1.5">
        <span className="text-sm">{question.text}</span>
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          className="shrink-0"
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
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex-1 text-sm">{question.text}</span>
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Answer…"
        className="h-8 w-80 text-sm"
      />
      {busy && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.5} />}
    </div>
  );
}

/** A fixed, hand-curated slice of your Reflections answers — see lifeDetails.ts for why these questions and not a generic category browse. */
export function LifeDetailsSection() {
  const [{ authToken }] = useAuth();
  const [rows, setRows] = useState<CuratedAnswers>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const loadAnswers = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchJson<CataloguePage>(curatedCatalogueUrl(), {
        headers: { ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
      });
      const { byKey, missingKeys } = indexCuratedAnswers(page?.data ?? []);

      // Loud, because the silent version of this is what shipped: a curated
      // key the catalogue has never heard of used to render a perfectly
      // normal-looking input that threw away whatever was typed into it.
      // Rows without a question to answer are not rendered at all (below).
      if (missingKeys.length > 0) {
        console.error(
          `Life details: ${missingKeys.length} curated question(s) are missing from the catalogue — ` +
            `their seed migration has not run, or they were added to lifeDetails.ts without one: ${missingKeys.join(', ')}`,
        );
      }

      setRows(byKey);
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

  // The question_id comes from the catalogue response, never from this file:
  // it is minted per appliance, which is the whole reason the curated list is
  // keyed by slug.
  const handleAnswer = async (questionKey: string, questionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || submittingKey) {
      return;
    }

    setSubmittingKey(questionKey);
    try {
      await fetchJson('/api/answers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ text: trimmed, question: { id: questionId } }),
      });
      setDrafts((prev) => ({ ...prev, [questionKey]: '' }));
      await loadAnswers();
    } catch {
      // Draft (if any) survives on failure so the user doesn't retype it.
    } finally {
      setSubmittingKey(null);
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
          {LIFE_DETAIL_THEMES.map((theme) => {
            // Only questions the catalogue actually returned a row for. An
            // input with no question behind it cannot save, so rendering one
            // would just be a prettier way of losing the answer; a theme left
            // with nothing drops its heading too rather than sitting empty.
            const askable = theme.questions.flatMap((question) => {
              const row = rows[question.key];

              return row ? [{ question, row }] : [];
            });

            if (askable.length === 0) {
              return null;
            }

            return (
              <div key={theme.key}>
                <h3 className="mb-1 text-sm font-medium">{theme.label}</h3>
                <div className="divide-y divide-border/60">
                  {askable.map(({ question, row }) => (
                    <QuestionRow
                      key={question.key}
                      question={question}
                      answer={row.answer?.text ?? null}
                      draft={drafts[question.key] ?? ''}
                      busy={submittingKey === question.key}
                      onDraftChange={(value) => setDrafts((prev) => ({ ...prev, [question.key]: value }))}
                      onAnswer={(text) => void handleAnswer(question.key, row.id, text)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
