import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, LoadingPage, usePageTitle } from '@ci/common';
import { Badge, Button, Card } from '@ci/shadcn';

import { PageContent } from '@/components/layout';
import type { AnswerForm } from '@/graphql/graphql';

import { grantLabel, knownAskerLabel, partyLabel, scopeSummary, searchBreadthNote } from './askBinding';
import { askDecisionState, askStatusLabel, OWNER_ANSWER_FORMS, type AskStatus } from './askPresentation';
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
  const [revokeGrant, revoking] = useMutation(REVOKE_ASK_GRANT, {
    onCompleted: () => void grants.refetch(),
  });

  const busy = approving.loading || declining.loading || running.loading;

  /**
   * The first mutation that failed, if any.
   *
   * Read for the same reason the queries' `error` is: a consent gesture that did
   * not happen must not look like one that did. `useMutation` records the error
   * here, but every mutate() below is fired from an event handler, so nothing
   * awaits its rejection — without {@link runAction} it surfaces as an unhandled
   * rejection in a console the owner will never open, and on screen as a Decline
   * button that appeared to work.
   */
  const actionError = approving.error ?? running.error ?? declining.error ?? revoking.error;

  /**
   * Fire a mutation, and on failure re-read the server rather than guessing.
   *
   * The refetch is the important half. The banner says the action failed; the
   * refetch is what stops the list underneath it from continuing to show the
   * state the owner THOUGHT they had reached — which matters most for the
   * approve/answer chain, where the first mutation can land and the second fail,
   * leaving a real, changed ask behind a failed gesture.
   */
  const runAction = (action: Promise<unknown>): void => {
    void action.catch(() => refetchAll());
  };

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
   *
   * `disclosureForm` carries the owner's "answer with less" pick. It is passed
   * through UNCHANGED and unvalidated on purpose: `runAsk` clamps it against the
   * form the archetype implies and keeps whichever discloses less, so the client
   * cannot use it to widen anything, and second-guessing it here would only
   * create a second, drifting copy of that rule.
   */
  const handleApprove = (id: string, disclosureForm?: AnswerForm): void => {
    runAction(
      approveAsk({ variables: { id } }).then(() =>
        runAsk({ variables: { id, redactItemIds: [], disclosureForm } }),
      ),
    );
  };

  const pending = (inbox.data?.askInbox ?? []).filter(
    (ask) => ask.status === 'delivered' || ask.status === 'under_review',
  );

  const grantGroups: GranteeGroup[] = groupGrants(grants.data?.myAskGrants ?? []);

  let content: ReactNode;

  /**
   * Every tab reads ITS OWN query's loading and error state.
   *
   * The guard used to be `inbox.loading && outbox.loading && grants.loading`,
   * which is false the instant any one of the three resolves — so a still-loading
   * grants query rendered "No standing grants. Every ask comes to you for
   * review." And neither `error` was read at all, so a failed request painted the
   * same reassuring empty page. On a consent surface both are the same bug: an
   * absence of information rendered as a positive claim that nothing is shared.
   */
  if (tab === 'inbox') {
    if (inbox.error) {
      content = <LoadFailure what="your inbox" onRetry={() => void inbox.refetch()} />;
    } else if (inbox.loading) {
      content = <LoadingPage />;
    } else {
      content = pending.length ? (
        <div className="flex flex-col gap-3">
          {pending.map((ask) => {
            const decision = askDecisionState(ask.status as AskStatus, ask.consentBasis);

            return (
              <AskReviewCard
                key={ask.id}
                askerName={partyLabel(ask.peerHandle, ask.askerId)}
                tier={knownAskerLabel(ask.consentBasis)}
                decision={decision}
                prompt={ask.query.prompt}
                scopeSummary={scopeSummary(ask.query)}
                searchBreadth={searchBreadthNote(ask.query)}
                downgrades={[...OWNER_ANSWER_FORMS]}
                busy={busy}
                onApprove={() => handleApprove(ask.id)}
                onDowngrade={(form) => handleApprove(ask.id, form)}
                onDecline={() => runAction(declineAsk({ variables: { id: ask.id } }))}
              />
            );
          })}
        </div>
      ) : (
        <EmptyState message="No one is waiting on you. Asks needing your review appear here." />
      );
    }
  } else if (tab === 'grants') {
    if (grants.error) {
      content = <LoadFailure what="your standing grants" onRetry={() => void grants.refetch()} />;
    } else if (grants.loading) {
      content = <LoadingPage />;
    } else {
      content = grantGroups.length ? (
        <GrantManager
          groups={grantGroups}
          defaultMode="review"
          onRevoke={(grantId) => runAction(revokeGrant({ variables: { id: grantId } }))}
          // Stated in the UI because the alternative is an owner assuming the
          // absence of an expiry date means there is none. See MY_ASK_GRANTS.
          caveat="When a grant lapses isn’t on the wire yet, so no expiry date is shown here."
        />
      ) : (
        <EmptyState message="No standing grants. Every ask comes to you for review." />
      );
    }
  } else if (outbox.error) {
    content = <LoadFailure what="the asks you have sent" onRetry={() => void outbox.refetch()} />;
  } else if (outbox.loading) {
    content = <LoadingPage />;
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

        {/* Above the list, not inside a tab: the action that failed may have
            been taken on a tab the owner has since left. */}
        {actionError ? (
          <Card className="flex flex-col gap-1 p-3" role="alert">
            <p className="font-medium">That didn’t go through.</p>
            <p className="text-muted-foreground text-sm">
              {actionError.message} — the list below has been re-read from your Companion, so trust it over
              what you expected to happen.
            </p>
          </Card>
        ) : null}

        {content}
      </div>
    </PageContent>
  );
}

/**
 * A query that failed, said plainly.
 *
 * Deliberately NOT an `EmptyState` with a sad message: "we could not ask" and
 * "the answer was none" are different facts, and on this page the second one is
 * a claim about what is being shared. The retry is here because a transient
 * failure otherwise strands the owner on a page that looks settled.
 */
function LoadFailure({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <Card className="flex flex-col items-start gap-2 p-4" role="alert">
      <p className="font-medium">Couldn’t load {what}.</p>
      <p className="text-muted-foreground text-sm">
        This is a failed request, not an empty one — read nothing into it about what is or isn’t being shared.
      </p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </Card>
  );
}

/**
 * One group per grantee.
 *
 * The component's `GranteeGroup` wants a display name and a tier per grantee.
 * Neither is on the wire — `granteeId` is an opaque GlobalUID and there is no
 * user query to resolve it — so the group is named by the same opaque label
 * used everywhere else rather than by a person's name that would be invented.
 *
 * `revokedAt` is carried through rather than dropped. The server's
 * `listForOwner` filters revoked and lapsed rows out today, so in practice every
 * row here is live — but "the server probably filtered it" is not something a
 * consent matrix may assume on the owner's behalf, and the field is already in
 * the selection set. Reading it costs one property; not reading it means a
 * withdrawn grant renders as current the day that filter changes.
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
    revokedAt?: string | null;
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
      revokedAt: row.revokedAt ?? null,
    });
  }

  return [...byGrantee.values()];
}
