import { useCallback, useEffect, useState } from 'react';

import { apiKeyHeaders, buildApiUrl, fetchJson } from '@ci/common';

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

/** Poll for a rotated question while one remains unanswered on the feed. */
const FEED_QUESTION_POLL_MS = 10 * 60 * 1000;

export function useFeedQuestionService(): ReturnType {
  const [{ authToken }] = useAuth();

  const [question, setQuestion] = useState<FeedQuestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

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
      const response = await fetch(buildApiUrl('/api/questions/unanswered'), {
        method: 'GET',
        headers: {
          ...apiKeyHeaders(),
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.status === 204) {
        setQuestion(null);

        return;
      }

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as Omit<FeedQuestion, 'presentationId'>;

      setQuestion({
        ...data,
        presentationId: data.id,
      });
    } catch (err) {
      setError(err);
      setQuestion(null);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

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

  // Re-fetch periodically so stale unanswered questions can rotate server-side.
  useEffect(() => {
    if (!authToken || !question) {
      return;
    }

    const handle = setInterval(() => {
      void fetchUnansweredQuestion();
    }, FEED_QUESTION_POLL_MS);

    return () => clearInterval(handle);
  }, [authToken, question, fetchUnansweredQuestion]);

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
