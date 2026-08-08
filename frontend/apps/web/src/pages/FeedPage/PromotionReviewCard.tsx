import { useCallback, useEffect, useState } from 'react';

import { fetchJson } from '@ci/common';
import { Button, Card } from '@ci/shadcn';

import { useAuth } from '@/hooks';

type PromotionCandidate = {
  id: string;
  kind: string;
  reviewPrompt: string | null;
  confidence: number;
  payload: Record<string, unknown>;
};

export function PromotionReviewCard() {
  const [{ authToken }] = useAuth();
  const [candidates, setCandidates] = useState<PromotionCandidate[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    try {
      const rows = (await fetchJson<PromotionCandidate[]>('/api/personalization/promotion-candidates', {
        headers: { Authorization: `Bearer ${authToken}` },
      })) ?? [];
      setCandidates(rows.slice(0, 3));
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (id: string, action: 'accept' | 'reject') => {
    if (!authToken) {
      return;
    }

    await fetchJson(`/api/personalization/promotion-candidates/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    setCandidates((prev) => prev.filter((c) => c.id !== id));
  };

  if (loading || candidates.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {candidates.map((candidate) => (
        <Card key={candidate.id}>
          <Card.Header>
            <Card.Title className="text-base">Review suggestion</Card.Title>
            <Card.Description>
              {candidate.reviewPrompt ??
                `Companion found a ${candidate.kind.replace('_', ' ')} (${Math.round(candidate.confidence * 100)}% confidence)`}
            </Card.Description>
          </Card.Header>
          <Card.Content className="flex gap-2">
            <Button size="sm" onClick={() => void respond(candidate.id, 'accept')}>
              Accept
            </Button>
            <Button size="sm" variant="outline" onClick={() => void respond(candidate.id, 'reject')}>
              Reject
            </Button>
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
