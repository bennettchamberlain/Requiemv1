import { useState, useEffect, type FormEvent } from 'react';

import { Button, Dialog, Textarea, Spinner } from '@ci/shadcn';
import { X } from '@ci/shadcn/icons';

interface Answer {
  id: string;
  answer: string;
  ragAnswer?: string;
  user?: { id: string };
  question?: {
    id: string;
    text: string;
  };
}

interface Props {
  open?: boolean;
  answer: Answer | null;
  onClose?: () => void;
  onSave?: (answerId: string, answerText: string) => Promise<void>;
}

export function EditAnswerDialog({ open, answer, onClose, onSave }: Props) {
  const [answerText, setAnswerText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update local state when answer changes
  useEffect(() => {
    if (answer) {
      setAnswerText(answer.answer || '');
      setError(null);
    }
  }, [answer]);

  const handleClose = () => {
    if (loading) {
      return;
    }

    setAnswerText('');
    setError(null);
    onClose?.();
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!answer || !onSave) {
      return;
    }

    if (!answerText.trim()) {
      setError('Answer text is required');

      return;
    }

    setLoading(true);
    setError(null);

    try {
      await onSave(answer.id, answerText.trim());
      handleClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to update answer';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!answer) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <Dialog.Content className="p-0 flex flex-col gap-0" showCloseButton={false}>
        <Dialog.Header className="flex flex-row items-center justify-between border-b bg-stone-50 dark:bg-secondary rounded-t-lg gap-2 p-2 pl-4">
          <Dialog.Title>Edit Answer</Dialog.Title>
          <Dialog.Description className="hidden">Edit the answer text.</Dialog.Description>

          <div className="flex items-center justify-end">
            <Button variant="ghost" size="icon" onClick={handleClose} disabled={loading}>
              <X />
            </Button>
          </div>
        </Dialog.Header>

        <form onSubmit={handleSave} className="flex flex-col gap-4 p-4">
          {answer.question && (
            <div>
              <label className="text-sm font-medium text-muted-foreground mb-1 block">Question</label>
              <div className="text-sm text-foreground p-2 bg-muted rounded-md">{answer.question.text}</div>
            </div>
          )}

          <div>
            <label htmlFor="answer-text" className="text-sm font-medium text-muted-foreground mb-1 block">
              Answer
            </label>
            <Textarea
              id="answer-text"
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              disabled={loading}
              className="min-h-32"
              placeholder="Enter your answer..."
            />
            {error && <p className="text-sm text-destructive mt-1">{error}</p>}
          </div>

          <Dialog.Footer>
            <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !answerText.trim()}>
              {loading ? <Spinner variant="circle" /> : null}
              Save
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
