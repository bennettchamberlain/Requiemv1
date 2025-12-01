import { useState, useEffect, useCallback, type FormEvent } from 'react';

import { Button, Card, Textarea, Spinner } from '@ci/shadcn';
import { Send } from '@ci/shadcn/icons';

import { useAuth } from '@/hooks';

interface Question {
  id: string;
  text: string;
  category?: string;
}

interface Props {
  onAnswerSubmitted?: () => void;
}

export function AnswerQuestionPrompt({ onAnswerSubmitted }: Props) {
  const [{ authToken }] = useAuth();
  const [question, setQuestion] = useState<Question | null>(null);
  const [answerText, setAnswerText] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchingQuestion, setFetchingQuestion] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [shouldShake, setShouldShake] = useState(false);

  const fetchUnansweredQuestion = useCallback(async () => {
    if (!authToken) {
      return;
    }

    try {
      setFetchingQuestion(true);
      setError(null);

      const response = await fetch('/api/questions/unanswered', {
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          // No unanswered questions - only clear if we truly have no questions
          setQuestion(null);
          setFetchingQuestion(false);

          return;
        }

        throw new Error(`Failed to fetch question: ${response.statusText}`);
      }

      const data = await response.json();
      // Update question - this will smoothly transition the question text
      setQuestion(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch question';
      setError(errorMessage);
      console.error('Error fetching unanswered question:', err);
      // Don't clear question on error - keep showing current one
    } finally {
      setFetchingQuestion(false);
    }
  }, [authToken]);

  useEffect(() => {
    fetchUnansweredQuestion();
  }, [authToken]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();

      if (!question || !authToken) {
        return;
      }

      const trimmedText = answerText.trim();
      if (!trimmedText) {
        setError('Answer text is required');
        setShouldShake(true);
        setTimeout(() => setShouldShake(false), 500);

        return;
      }

      if (trimmedText.length > 5000) {
        setError('Answer text must be 5000 characters or less');
        setShouldShake(true);
        setTimeout(() => setShouldShake(false), 500);

        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/answers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: trimmedText,
            question: {
              id: question.id,
            },
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || `Failed to submit answer: ${response.statusText}`);
        }

        // Reset form and fetch next question
        setAnswerText('');
        onAnswerSubmitted?.();
        // Keep current question visible while fetching next one to prevent flash
        await fetchUnansweredQuestion();
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Failed to submit answer';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    },
    [question, authToken, answerText, onAnswerSubmitted, fetchUnansweredQuestion],
  );

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Don't render if dismissed or no question and not loading
  if (dismissed || (!question && !fetchingQuestion)) {
    return null;
  }

  return (
    <Card className="p-4 mb-4 border-primary/20 bg-primary/5">
      {fetchingQuestion && !question ? (
        <div className="flex items-center gap-2">
          <Spinner variant="circle" className="h-4 w-4" />
          <span className="text-sm text-muted-foreground">Loading question...</span>
        </div>
      ) : question ? (
        <form onSubmit={handleSubmit} className="space-y-3" key="answer-question-form">
          <div>
            <label className="text-sm font-medium text-foreground mb-2 block">
              {fetchingQuestion && (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-2">
                  <Spinner variant="circle" className="h-3 w-3" />
                </span>
              )}
              {question.text}
            </label>
            <Textarea
              value={answerText}
              onChange={(e) => {
                setAnswerText(e.target.value);
                setError(null);
              }}
              disabled={loading}
              className={`min-h-24 transition-all ${
                error
                  ? 'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/20'
                  : ''
              } ${shouldShake ? 'animate-shake' : ''}`}
              placeholder="Enter your answer..."
              maxLength={5000}
            />
            <div className="flex items-center justify-between mt-1">
              {error && <p className="text-sm text-destructive">{error}</p>}
              <p
                className={`text-xs ml-auto ${answerText.length > 5000 ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                {answerText.length}/5000
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={loading} size="sm">
              {loading ? (
                <Spinner variant="circle" className="h-4 w-4 mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Submit Answer
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={handleDismiss} disabled={loading}>
              Skip
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
