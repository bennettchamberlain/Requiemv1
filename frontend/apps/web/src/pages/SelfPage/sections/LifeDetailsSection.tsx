import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Input, Textarea, ToggleGroup, cn } from '@ci/shadcn';
import { Loader2, NotebookPen, Pencil } from '@ci/shadcn/icons';

import { AnswerProvenance } from '@/components/AnswerProvenance';
import { useAuth } from '@/hooks';
import type { CatalogueAnswer, CataloguePage } from '@/pages/PromptsPage/catalogue';

import {
  curatedCatalogueUrl,
  LIFE_DETAIL_THEMES,
  type CuratedAnswers,
  type CuratedQuestion,
} from './lifeDetails';

/** Debounce between the last keystroke and an unanswered row autosaving. */
const ANSWER_AUTOSAVE_DEBOUNCE_MS = 900;

/** Mirrors `createAnswerSchema`/`updateAnswerSchema` on the API, which reject longer text. */
const ANSWER_MAX_LENGTH = 5000;

/**
 * Both cells of one row, side by side in the theme's shared grid.
 *
 * The wrapper is `display: contents` on purpose: the row needs to exist in the
 * DOM (to key, to scope a test, to carry `data-question-id`) but must NOT be a
 * grid item, or every row would become its own two-column grid and the columns
 * would re-measure per row instead of lining up down the section. With
 * `contents` the two cells are promoted into the theme grid, so one column
 * width is resolved for all of a theme's questions at once — which is what
 * makes Q and A read as columns rather than as independent flex lines.
 *
 * Borders live on the cells, not the wrapper (a `contents` box paints nothing).
 * On a narrow viewport the grid collapses to one column and the cells stack, so
 * the question's own rule is dropped there — otherwise every question would be
 * separated from its own answer by a divider.
 */
function Row({ question, children }: { question: CuratedQuestion; children: React.ReactNode }) {
  return (
    <div className="contents" data-question-id={question.id}>
      <div className="pt-2.5 text-sm text-muted-foreground sm:border-b sm:border-border/60 sm:pb-2.5 sm:pr-6">
        {question.text}
      </div>
      <div className="border-b border-border/60 pb-2.5 pt-1 sm:pt-2.5">{children}</div>
    </div>
  );
}

/**
 * The answer as it reads when nothing is being edited: full text, wrapped —
 * never truncated, which was the whole complaint — and clickable to edit, with
 * the provenance badge trailing at the right edge of the answer column so the
 * badges line up down the section too.
 */
function AnswerDisplay({
  question,
  answer,
  onEdit,
}: {
  question: CuratedQuestion;
  answer: CatalogueAnswer;
  onEdit: () => void;
}) {
  return (
    // Side by side once there is width for it, so the badges line up as their
    // own column; stacked below `sm`, where sitting the badge beside the text
    // would squeeze a long answer into a sliver and leave the rest blank.
    <div className="flex flex-col items-start gap-1 sm:flex-row sm:gap-2">
      <button
        type="button"
        onClick={onEdit}
        aria-label={`Edit your answer to “${question.text}”`}
        className="group -mx-1 w-full min-w-0 rounded-sm px-1 text-left text-sm text-foreground/90 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:w-auto sm:flex-1"
      >
        <span className="whitespace-pre-wrap break-words">{answer.text}</span>
        {/* Discoverability only — the button itself is the affordance, and its
            aria-label already says what activating it does. */}
        <Pencil
          className="ml-1.5 inline-block h-3 w-3 shrink-0 align-baseline text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>

      <AnswerProvenance
        source={answer.source}
        confidence={answer.confidence}
        rationale={answer.rationale}
        className="shrink-0 sm:mt-px"
      />
    </div>
  );
}

/**
 * Editing an existing answer. Explicitly Save/Cancel rather than the debounced
 * autosave the empty rows use: overwriting words already on the profile — some
 * of them the appliance's guesses, which is exactly what the user is here to
 * correct — should take a deliberate keystroke, and needs a way out that
 * restores what was there.
 */
function AnswerEditor({
  question,
  draft,
  busy,
  error,
  onDraftChange,
  onSave,
  onCancel,
}: {
  question: CuratedQuestion;
  draft: string;
  busy: boolean;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  // An options question's answer domain IS its option list, so editing one is
  // picking again — not retyping. That is the path out of a rambling inferred
  // answer to "morning person or night owl?": one click replaces it.
  if (question.options) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          size="sm"
          variant="outline"
          value={draft}
          onValueChange={(value) => value && onSave(value)}
        >
          {question.options.map((option) => (
            <ToggleGroup.Item key={option} value={option} className="px-3 text-xs" disabled={busy}>
              {option}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup>

        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>

        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" strokeWidth={1.5} />}
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        // Focus follows the click that opened the editor — the user asked to
        // type here, so it would otherwise take a second click to do it.
        autoFocus
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }

          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave(draft);
          }
        }}
        rows={question.tier === 'narrative' ? 3 : 2}
        maxLength={ANSWER_MAX_LENGTH}
        disabled={busy}
        aria-label={`Your answer to “${question.text}”`}
        className="min-h-0 text-sm"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(draft)}
          disabled={busy || draft.trim().length === 0}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />}
          {busy ? 'Saving…' : 'Save'}
        </Button>

        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>

        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A row with no answer yet, rendered by type: button options as a ToggleGroup
 * (saves immediately on click), a narrative-tier open question as a compact
 * Textarea, everything else as a single-line Input — both text controls
 * autosave a fixed delay after the last keystroke, matching the identity form
 * above.
 */
function AnswerPrompt({
  question,
  draft,
  busy,
  onDraftChange,
  onAnswer,
}: {
  question: CuratedQuestion;
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

  if (question.options) {
    // The question is NOT repeated here: it lives in this row's own grid cell
    // (see `Row`), so rendering it again would double it in every unanswered row.
    return (
      <div className="flex flex-wrap items-center gap-2">
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

        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" strokeWidth={1.5} />}
      </div>
    );
  }

  if (question.tier === 'narrative') {
    return (
      <div className="flex items-start gap-2">
        <Textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          rows={2}
          maxLength={ANSWER_MAX_LENGTH}
          placeholder="Your answer…"
          aria-label={`Your answer to “${question.text}”`}
          className="min-h-0 flex-1 text-sm"
        />
        {busy && (
          <Loader2
            className="mt-2 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            strokeWidth={1.5}
          />
        )}
      </div>
    );
  }

  return (
    // Question omitted for the same reason as the options branch above — it is
    // already this row's left grid cell.
    <div className="flex items-center gap-2">
      <Input
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        maxLength={ANSWER_MAX_LENGTH}
        placeholder="Answer…"
        aria-label={`Your answer to “${question.text}”`}
        className="h-8 w-full min-w-0 text-sm"
      />
      {busy && (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={1.5} />
      )}
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
  // One row edits at a time, so the in-flight text and its error are single
  // values rather than another map keyed by question.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    }),
    [authToken],
  );

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
        headers: authHeaders(),
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

  const startEdit = (questionId: string) => {
    setEditingId(questionId);
    setEditDraft(answers[questionId]?.text ?? '');
    setEditError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft('');
    setEditError(null);
  };

  /**
   * Rewrites an existing answer in place.
   *
   * PATCH, not another POST: `AnswerService.create` always INSERTs, so
   * re-answering would pile duplicate rows behind the newest one. More
   * importantly, a PATCH carrying only `text` is what the API treats as a user
   * correction — it flips `answer_source` to `user_input` and `answer_method`
   * to `user`, and clears the confidence and rationale the model left behind
   * (`AnswerService.update`). That is the whole point of letting someone edit a
   * guess: once these are their words, the row must stop wearing an "Inferred"
   * badge and a score for text the model no longer wrote. Passing any explicit
   * source here would opt out of that, so we deliberately send `text` alone.
   */
  const handleUpdate = async (questionId: string, text: string) => {
    const trimmed = text.trim();
    if (!trimmed || submittingId) {
      return;
    }

    if (trimmed.length > ANSWER_MAX_LENGTH) {
      setEditError(`Keep it under ${ANSWER_MAX_LENGTH.toLocaleString()} characters.`);

      return;
    }

    const answerId = answers[questionId]?.id;
    if (!answerId) {
      // No row to rewrite (the refetch that would have supplied the id failed,
      // or the answer was removed elsewhere) — write a fresh one instead.
      cancelEdit();
      await handleAnswer(questionId, trimmed);

      return;
    }

    setSubmittingId(questionId);
    setEditError(null);
    try {
      await fetchJson(`/api/answers/${answerId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ text: trimmed }),
      });
      setEditingId(null);
      setEditDraft('');
      await loadAnswers();
    } catch {
      // Stay in the editor with the typed text intact so it can be retried.
      setEditError("Couldn't save that. Try again.");
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

              {/* One grid per theme, two tracks: the question column is capped
                  so long questions wrap instead of squeezing the answers, and
                  collapses to a single stacked column below `sm`. */}
              <div
                className={cn(
                  'grid grid-cols-1 items-start',
                  'sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-stretch',
                )}
              >
                {theme.questions.map((question) => {
                  const answer = answers[question.id] ?? null;
                  const busy = submittingId === question.id;

                  return (
                    <Row key={question.id} question={question}>
                      {answer && editingId === question.id ? (
                        <AnswerEditor
                          question={question}
                          draft={editDraft}
                          busy={busy}
                          error={editError}
                          onDraftChange={setEditDraft}
                          onSave={(text) => void handleUpdate(question.id, text)}
                          onCancel={cancelEdit}
                        />
                      ) : answer ? (
                        <AnswerDisplay
                          question={question}
                          answer={answer}
                          onEdit={() => startEdit(question.id)}
                        />
                      ) : (
                        <AnswerPrompt
                          question={question}
                          draft={drafts[question.id] ?? ''}
                          busy={busy}
                          onDraftChange={(value) => setDrafts((prev) => ({ ...prev, [question.id]: value }))}
                          onAnswer={(text) => void handleAnswer(question.id, text)}
                        />
                      )}
                    </Row>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
