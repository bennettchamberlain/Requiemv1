import { useEffect, useId, useState, type FormEvent } from 'react';

import { Button, Dialog, Input, Select, Spinner, Textarea } from '@ci/shadcn';

import {
  ANSWER_TIERS,
  ANSWER_TIER_DESCRIPTIONS,
  ANSWER_TIER_LABELS,
  type AnswerTier,
  type CatalogueEntry,
} from './catalogue';
import type { ReflectionDraft } from './useReflectionCatalogue';

/** The API caps reflection text here; mirrored so the counter is not a lie. */
const MAX_TEXT_LENGTH = 500;

/** Radix Select has no value for "nothing selected", so an explicit sentinel. */
const NO_TIER = '__none__';

interface Props {
  open: boolean;
  /** null opens the dialog in create mode. */
  reflection: CatalogueEntry | null;
  /** Categories already in the catalogue, offered as suggestions. */
  categories: string[];
  onClose: () => void;
  onSave: (draft: ReflectionDraft) => Promise<void>;
}

/**
 * Write half of the catalogue surface: compose a new reflection, or correct the
 * wording, category or tier of one that already exists.
 *
 * There is no delete here on purpose. `ci.answers` and `ci.feed_queue` both
 * cascade from `ci.questions`, so deleting a reflection silently destroys the
 * answers a person actually wrote. Retiring one is "Deactivate" on the row.
 */
export function EditReflectionDialog({ open, reflection, categories, onClose, onSave }: Props) {
  const fieldId = useId();
  const isEditing = reflection !== null;

  const [text, setText] = useState('');
  const [category, setCategory] = useState('');
  const [answerTier, setAnswerTier] = useState<string>(NO_TIER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever the dialog is opened on a different row (or on none).
  useEffect(() => {
    if (!open) {
      return;
    }

    setText(reflection?.text ?? '');
    setCategory(reflection?.category ?? '');
    setAnswerTier(reflection?.answerTier ?? NO_TIER);
    setError(null);
    setSaving(false);
  }, [open, reflection]);

  const handleClose = () => {
    if (saving) {
      return;
    }

    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmed = text.trim();

    if (!trimmed) {
      setError('Reflection text is required');

      return;
    }

    if (trimmed.length > MAX_TEXT_LENGTH) {
      setError(`Reflection text must be ${MAX_TEXT_LENGTH} characters or less`);

      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave({
        text: trimmed,
        category: category.trim() || null,
        answerTier: answerTier === NO_TIER ? null : (answerTier as AnswerTier),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the reflection.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : handleClose())}>
      <Dialog.Content className="sm:max-w-lg">
        <Dialog.Header>
          <Dialog.Title>{isEditing ? 'Edit reflection' : 'New reflection'}</Dialog.Title>
          <Dialog.Description>
            {isEditing
              ? 'Reword it, move it to another category, or change what kind of answer it asks for. Answers already given are kept.'
              : 'Add a question you want the appliance to ask you.'}
          </Dialog.Description>
        </Dialog.Header>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor={`${fieldId}-text`} className="text-sm font-medium">
              Question
            </label>
            <Textarea
              id={`${fieldId}-text`}
              value={text}
              onChange={(event) => {
                setText(event.currentTarget.value);
                setError(null);
              }}
              disabled={saving}
              className="min-h-24"
              placeholder="What would you like to be asked?"
              maxLength={MAX_TEXT_LENGTH}
            />
            <p className="text-xs text-muted-foreground text-right">
              {text.trim().length}/{MAX_TEXT_LENGTH}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${fieldId}-category`} className="text-sm font-medium">
                Category
              </label>
              <Input
                id={`${fieldId}-category`}
                value={category}
                onChange={(event) => setCategory(event.currentTarget.value)}
                disabled={saving}
                list={`${fieldId}-categories`}
                placeholder="e.g. Health & Body"
              />
              {/* A datalist rather than a select: the catalogue's categories are
                  free text in the database, so an existing one should be one
                  keystroke away without making a new one impossible. */}
              <datalist id={`${fieldId}-categories`}>
                {categories.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Answer type</span>
              <Select value={answerTier} onValueChange={setAnswerTier} disabled={saving}>
                <Select.Trigger aria-label="Answer type">
                  <Select.Value />
                </Select.Trigger>
                <Select.Content>
                  <Select.Item value={NO_TIER}>Unset</Select.Item>
                  {ANSWER_TIERS.map((tier) => (
                    <Select.Item key={tier} value={tier}>
                      {ANSWER_TIER_LABELS[tier]}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select>
              <p className="text-xs text-muted-foreground">
                {answerTier === NO_TIER
                  ? 'Untyped reflections are asked last.'
                  : ANSWER_TIER_DESCRIPTIONS[answerTier as AnswerTier]}
              </p>
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Dialog.Footer>
            <Button type="button" variant="secondary" onClick={handleClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner variant="circle" /> : null}
              {isEditing ? 'Save changes' : 'Create reflection'}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
