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
  evidence?: Array<{ text?: string }>;
};

function extractValueText(candidate: PromotionCandidate): string | null {
  if (typeof candidate.payload.inferredText === 'string' && candidate.payload.inferredText.trim()) {
    return candidate.payload.inferredText.trim();
  }

  if (typeof candidate.payload.valueText === 'string' && candidate.payload.valueText.trim()) {
    return candidate.payload.valueText.trim();
  }

  const evidenceText = candidate.evidence?.find((item) => typeof item.text === 'string' && item.text.trim());

  return evidenceText?.text?.trim() ?? null;
}

export function PromotionReviewCard() {
  const [{ authToken }] = useAuth();
  const [candidate, setCandidate] = useState<PromotionCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const rows =
        (await fetchJson<PromotionCandidate[]>('/api/personalization/promotion-candidates', {
          headers: { Authorization: `Bearer ${authToken}` },
        })) ?? [];
      setCandidate(rows[0] ?? null);
    } catch {
      setCandidate(null);
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const respond = async (id: string, action: 'accept' | 'reject') => {
    if (!authToken || responding) {
      return;
    }

    setResponding(true);
    setError(null);
    try {
      await fetchJson(`/api/personalization/promotion-candidates/${id}/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      await load();
    } catch {
      setError(action === 'accept' ? 'Could not save that answer.' : 'Could not dismiss that suggestion.');
    } finally {
      setResponding(false);
    }
  };

  if (loading || !candidate) {
    return null;
  }

  const reviewQuestion =
    candidate.reviewPrompt ??
    (typeof candidate.payload.questionText === 'string'
      ? candidate.payload.questionText
      : 'Is this accurate?');
  const valueText = extractValueText(candidate);
  const showValue = valueText !== null && valueText !== reviewQuestion;

  return (
    <Card>
      <Card.Header>
        <Card.Title className="text-base">Quick check</Card.Title>
        <Card.Description>
          <span className="block font-medium text-foreground">{reviewQuestion}</span>
          {showValue ? <span className="mt-1 block text-muted-foreground">{valueText}</span> : null}
        </Card.Description>
      </Card.Header>
      <Card.Content className="flex flex-col gap-2">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div className="flex gap-2">
          <Button size="sm" disabled={responding} onClick={() => void respond(candidate.id, 'accept')}>
            Yes
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={responding}
            onClick={() => void respond(candidate.id, 'reject')}
          >
            No
          </Button>
        </div>
      </Card.Content>
    </Card>
  );
}
