import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchJson } from '@ci/common';

import { useAuth } from '@/hooks';

export interface FeedQuestion {
  id: string;
  text: string;
  category?: string | null;
  questionType?: string | null;
  contextTags?: string[] | null;
  presentationId: string;
}

type ReturnType = [
  {
    question: FeedQuestion | null;
    loading: boolean;
    submitting: boolean;
    error: unknown | null;
  },
  {
    refetch: () => Promise<void>;
    submitAnswer: (input: { questionId: string; text: string }) => Promise<boolean>;
  },
];

export function useFeedQuestionService(): ReturnType {
  const [{ authToken }] = useAuth();
  const lastPresentedQuestionIdRef = useRef<string | null>(null);

  const [question, setQuestion] = useState<FeedQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  const createPresentationId = useCallback(() => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }, []);

  const pickRandomQuestion = useCallback(
    (questions: Array<Omit<FeedQuestion, 'presentationId'>>): Omit<FeedQuestion, 'presentationId'> | null => {
      if (questions.length === 0) {
        return null;
      }

      let index = Math.floor(Math.random() * questions.length);

      if (questions.length > 1 && lastPresentedQuestionIdRef.current) {
        const previousIndex = questions.findIndex((item) => item.id === lastPresentedQuestionIdRef.current);

        if (previousIndex >= 0 && index === previousIndex) {
          index = (index + 1) % questions.length;
        }
      }

      return questions[index] ?? null;
    },
    [],
  );

  const fetchRandomQuestion = useCallback(async (): Promise<FeedQuestion | null> => {
    const questions = await fetchJson<Array<Omit<FeedQuestion, 'presentationId'>>>('/api/questions', {
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    const selected = pickRandomQuestion(questions);

    if (!selected) {
      return null;
    }

    lastPresentedQuestionIdRef.current = selected.id;

    return {
      ...selected,
      presentationId: createPresentationId(),
    };
  }, [authToken, createPresentationId, pickRandomQuestion]);

  const fetchUnansweredQuestion = useCallback(async () => {
    if (!authToken) {
      setQuestion(null);
      setLoading(false);
      setError(null);

      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/questions/unanswered', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 204) {
        const fallbackQuestion = await fetchRandomQuestion();

        setQuestion(fallbackQuestion);

        return;
      }

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as Omit<FeedQuestion, 'presentationId'>;

      lastPresentedQuestionIdRef.current = data.id;

      setQuestion({
        ...data,
        presentationId: createPresentationId(),
      });
    } catch (err) {
      setError(err);
      setQuestion(null);
    } finally {
      setLoading(false);
    }
  }, [authToken, createPresentationId, fetchRandomQuestion]);

  const submitAnswer = useCallback(
    async ({ questionId, text }: { questionId: string; text: string }): Promise<boolean> => {
      if (!authToken) {
        return false;
      }

      setSubmitting(true);
      setError(null);

      try {
        await fetchJson('/api/answers', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text,
            question: {
              id: questionId,
            },
          }),
        });

        await fetchUnansweredQuestion();

        return true;
      } catch (err) {
        setError(err);

        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [authToken, fetchUnansweredQuestion],
  );

  useEffect(() => {
    void fetchUnansweredQuestion();
  }, [fetchUnansweredQuestion]);

  return [
    {
      question,
      loading,
      submitting,
      error,
    },
    {
      refetch: fetchUnansweredQuestion,
      submitAnswer,
    },
  ];
}
