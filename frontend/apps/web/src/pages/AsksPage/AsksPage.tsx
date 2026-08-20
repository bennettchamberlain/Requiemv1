import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, LoadingPage, usePageTitle } from '@ci/common';
import { Badge, Button, Card } from '@ci/shadcn';

import { PageContent } from '@/components/layout';

import { grantLabel, isUnknownAsker, knownAskerLabel, partyLabel, scopeSummary } from './askBinding';
import { askStatusLabel, type AskStatus } from './askPresentation';
import { AskReviewCard } from './AskReviewCard';
import {
  APPROVE_ASK,
  ASK_INBOX,
  ASK_OUTBOX,
  DECLINE_ASK,
  MY_ASK_GRANTS,
  REVOKE_ASK_GRANT,
  RUN_ASK,
} from './asksOperations';
import { GrantManager, type GranteeGroup } from './GrantManager';

type Tab = 'inbox' | 'grants' | 'outbox';

/**
 * The asks surface — the first one a user can actually open.
 *
 * Four components for this feature merged with the trust-graph work and then
 * sat unreachable: no route, no container, and no GraphQL operation documents,
 * so the only place they rendered was Storybook. This page is the container.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It does not render the answer card, and it does not render a review preview
 * with items in it. Both need facts the API cannot supply yet:
 *
 *   - `AnswerCard` requires `autoAnswered`, and nothing on the wire
 *     distinguishes an answer a human reviewed from one a standing grant
 *     released. Its whole purpose is the provenance line — "reviewed by Sam"
 *     vs "auto-answered under your family grant" — so rendering it without
 *     that field would print a provenance claim the server never made. That is
 *     the one thing a consent UI must never do.
 *   - `AskReviewCard`'s item list is the "see what you are about to share
 *     before you approve" contract, and no query returns the candidate matches
 *     before the answer is produced. Passing an empty list is honest; passing a
 *     fabricated one is not.
 *
 * Both are tracked as follow-ups rather than faked. Everything below binds only
 * to fields that exist — see askBinding.ts for why each derived value is the
 * most that can be said truthfully.
 */
export function AsksPage() {
  usePageTitle('Asks');

  const [tab, setTab] = useState<Tab>('inbox');

  const inbox = useQuery(ASK_INBOX);
  const outbox = useQuery(ASK_OUTBOX);
  const grants = useQuery(MY_ASK_GRANTS);

  const refetchAll = () => {
    void inbox.refetch();
    void grants.refetch();
  };

  const [approveAsk, approving] = useMutation(APPROVE_ASK, { onCompleted: refetchAll });
  const [declineAsk, declining] = useMutation(DECLINE_ASK, { onCompleted: refetchAll });
  const [runAsk, running] = useMutation(RUN_ASK, { onCompleted: refetchAll });
  const [revokeGrant] = useMutation(REVOKE_ASK_GRANT, { onCompleted: () => void grants.refetch() });

  const busy = approving.loading || declining.loading || running.loading;

  /**
   * Approve then answer.
   *
   * These are two mutations because the server models them as two transitions:
   * approving moves the ask to `answering`, and `runAsk` is what actually
   * produces and discloses the answer. Chaining them here keeps the owner's
   * single "Approve" gesture matching the single decision they think they are
   * making, while leaving the server's gate intact — `runAsk` re-checks the
   * lifecycle itself and refuses a non-answerable ask, so a failure between the
   * two cannot disclose anything.
   */
  const handleApprove = async (id: string) => {
    await approveAsk({ variables: { id } });
    await runAsk({ variables: { id, redactItemIds: [] } });
  };

  const pending = (inbox.data?.askInbox ?? []).filter(
    (ask) => ask.status === 'delivered' || ask.status === 'under_review',
  );

  const grantGroups: GranteeGroup[] = groupGrants(grants.data?.myAskGrants ?? []);

  let content: ReactNode;

  if (inbox.loading && outbox.loading && grants.loading) {
    content = <LoadingPage />;
  } else if (tab === 'inbox') {
    content = pending.length ? (
      <div className="flex flex-col gap-3">
        {pending.map((ask) => (
          <AskReviewCard
            key={ask.id}
            askerName={partyLabel(ask.peerHandle, ask.askerId)}
            tier={knownAskerLabel(ask.consentBasis)}
            unknownAsker={isUnknownAsker(ask.consentBasis)}
            prompt={ask.query.prompt}
            scopeSummary={scopeSummary(ask.query)}
            busy={busy}
            onApprove={() => void handleApprove(ask.id)}
            onDecline={() => void declineAsk({ variables: { id: ask.id } })}
          />
        ))}
      </div>
    ) : (
      <EmptyState message="No one is waiting on you. Asks needing your review appear here." />
    );
  } else if (tab === 'grants') {
    content = grantGroups.length ? (
      <GrantManager
        groups={grantGroups}
        defaultMode="review"
        onRevoke={(grantId) => void revokeGrant({ variables: { id: grantId } })}
      />
    ) : (
      <EmptyState message="No standing grants. Every ask comes to you for review." />
    );
  } else {
    const sent = outbox.data?.askOutbox ?? [];

    content = sent.length ? (
      <div className="flex flex-col gap-2">
        {sent.map((ask) => (
          <Card key={ask.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="font-medium">{partyLabel(ask.peerHandle, ask.responderId)}</span>
            <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">{ask.query.prompt}</span>
            <Badge variant="secondary">{askStatusLabel(ask.status as AskStatus)}</Badge>
          </Card>
        ))}
      </div>
    ) : (
      <EmptyState message="You haven't asked anyone anything yet." />
    );
  }

  return (
    <PageContent>
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Asks</h1>
          <p className="text-muted-foreground text-sm">
            Questions between Companions — answered only with what you allow.
          </p>
        </div>

        {/* Text, not colour alone, carries which tab is current (WCAG 1.4.1);
            the count is part of the label so a pending queue is visible without
            opening the tab. */}
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['inbox', `For you${pending.length ? ` (${pending.length})` : ''}`],
              ['grants', 'Who can ask me what'],
              ['outbox', 'Sent'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={tab === key ? 'default' : 'outline'}
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        {content}
      </div>
    </PageContent>
  );
}

/**
 * One group per grantee.
 *
 * The component's `GranteeGroup` wants a display name and a tier per grantee.
 * Neither is on the wire — `granteeId` is an opaque GlobalUID and there is no
 * user query to resolve it — so the group is named by the same opaque label
 * used everywhere else rather than by a person's name that would be invented.
 */
function groupGrants(
  rows: readonly {
    id: string;
    mode: string;
    queryType: string;
    dataClass?: string | null;
    purpose?: string | null;
    granteeId?: string | null;
    granteePeerLinkId?: string | null;
  }[],
): GranteeGroup[] {
  const byGrantee = new Map<string, GranteeGroup>();

  for (const row of rows) {
    const key = row.granteeId ?? row.granteePeerLinkId ?? 'unknown';

    let group = byGrantee.get(key);

    if (!group) {
      group = {
        id: key,
        name: partyLabel(null, key === 'unknown' ? null : key),
        // No tier exists on the wire. Saying so is better than picking one.
        tier: 'tier unknown',
        grants: [],
      };
      byGrantee.set(key, group);
    }

    group.grants.push({
      id: row.id,
      label: grantLabel(row.queryType, row.dataClass),
      mode: row.mode as GranteeGroup['grants'][number]['mode'],
      note: row.purpose ?? undefined,
    });
  }

  return [...byGrantee.values()];
}
