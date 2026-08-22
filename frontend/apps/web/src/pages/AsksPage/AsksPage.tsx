import { type ReactNode, useState } from 'react';

import { useMutation, useQuery } from '@apollo/client';
import { EmptyState, LoadingPage, usePageTitle } from '@ci/common';
import { Badge, Button, Card } from '@ci/shadcn';

import { PageContent } from '@/components/layout';
import type { AnswerForm } from '@/graphql/graphql';

import { AnswerPanel } from './AnswerPanel';
import { grantLabel, knownAskerLabel, partyLabel, scopeSummary, searchBreadthNote } from './askBinding';
import { AskComposer } from './AskComposer';
import {
  type AskAuditOutcome,
  askDecisionState,
  askStatusLabel,
  type AskStatus,
  OWNER_ANSWER_FORMS,
  peerTrustLabel,
} from './askPresentation';
import { AskReviewCard } from './AskReviewCard';
import {
  APPROVE_ASK,
  ASK_DISCLOSURE_HISTORY,
  ASK_INBOX,
  ASK_OUTBOX,
  CREATE_ASK,
  CREATE_PEER_LINK,
  DECLINE_ASK,
  MY_ASK_GRANTS,
  MY_PEER_LINKS,
  REVOKE_ASK_GRANT,
  REVOKE_PEER_LINK,
  RUN_ASK,
  UPDATE_ASK_GRANT,
  UPDATE_PEER_LINK,
} from './asksOperations';
import { COMPOSER_SHAPES, composeRecipients, unreachablePeers } from './composeRecipients';
import { DisclosureHistory } from './DisclosureHistory';
import { GrantManager, type GranteeGroup } from './GrantManager';
import { PeerManager } from './PeerManager';

type Tab = 'inbox' | 'compose' | 'outbox' | 'grants' | 'peers' | 'history';

/**
 * The asks surface.
 *
 * ═══ WHAT THIS PAGE USED TO NOT DO, AND WHY IT DOES IT NOW ═══
 *
 * Four components for this feature merged with the trust-graph work and sat
 * unreachable. The container that followed made the READ-AND-REACT half work —
 * an owner could see who was asking and approve, cap or decline — and stopped
 * there, wiring seven of sixteen operations and none of the writes. Three of the
 * four gaps it documented as "the API cannot supply this" were true when it was
 * written and are not true now:
 *
 *   - `AnswerCard` needed an `autoAnswered` discriminator. It still does not
 *     exist on `AskAnswerType`, and the honest resolution turned out not to be
 *     omitting the card but giving provenance a THIRD value — see
 *     {@link AnswerPanel}. The card renders; it just does not claim a review
 *     that nobody disclosed.
 *   - A recipient for `createAsk` looked impossible without a user-search
 *     endpoint. It is possible without one: the owner's own grants, inbox and
 *     outbox already name everybody they have a relationship with. See
 *     {@link composeRecipients}.
 *   - Grant expiry and mode changes were called "not on the wire". Both are, and
 *     were: `AskGrantType.expiresAt`/`active` and `updateAskGrant`. The page was
 *     printing a false limitation, which an owner plans around — "I cannot
 *     time-limit this, so I will remember to revoke it" is a worse plan than the
 *     one they would have made knowing the truth.
 *
 * What remains genuinely absent is named where it bites: a display NAME for a
 * local user (so every party is an opaque, visibly-truncated id), per-item
 * LABELS on a disclosed reference, and any way to address an ask to a linked
 * PEER from this client.
 */
export function AsksPage() {
  usePageTitle('Asks');

  const [tab, setTab] = useState<Tab>('inbox');
  const [openAnswerId, setOpenAnswerId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const inbox = useQuery(ASK_INBOX);
  const outbox = useQuery(ASK_OUTBOX);
  const grants = useQuery(MY_ASK_GRANTS);
  const peers = useQuery(MY_PEER_LINKS);
  const history = useQuery(ASK_DISCLOSURE_HISTORY);

  const refetchAll = () => {
    void inbox.refetch();
    void grants.refetch();
    // The owner's receipt of what left the box. Re-read after every decision,
    // because the whole point of the history is that it is not stale.
    void history.refetch();
  };

  const [approveAsk, approving] = useMutation(APPROVE_ASK, { onCompleted: refetchAll });
  const [declineAsk, declining] = useMutation(DECLINE_ASK, { onCompleted: refetchAll });
  const [runAsk, running] = useMutation(RUN_ASK, { onCompleted: refetchAll });
  const [revokeGrant, revoking] = useMutation(REVOKE_ASK_GRANT, {
    onCompleted: () => void grants.refetch(),
  });
  const [updateGrant, updatingGrant] = useMutation(UPDATE_ASK_GRANT, {
    onCompleted: () => void grants.refetch(),
  });
  const [createAsk, creating] = useMutation(CREATE_ASK, {
    onCompleted: () => void outbox.refetch(),
  });
  const [createPeerLink, linking] = useMutation(CREATE_PEER_LINK, {
    onCompleted: () => void peers.refetch(),
  });
  const [updatePeerLink, retiering] = useMutation(UPDATE_PEER_LINK, {
    onCompleted: () => void peers.refetch(),
  });
  const [revokePeerLink, unlinking] = useMutation(REVOKE_PEER_LINK, {
    onCompleted: () => void peers.refetch(),
  });

  const busy = approving.loading || declining.loading || running.loading;
  const grantBusy = revoking.loading || updatingGrant.loading;
  const peerBusy = linking.loading || retiering.loading || unlinking.loading;

  /**
   * The first mutation that failed, if any.
   *
   * Read for the same reason the queries' `error` is: a consent gesture that did
   * not happen must not look like one that did. `useMutation` records the error
   * here, but every mutate() below is fired from an event handler, so nothing
   * awaits its rejection — without {@link runAction} it surfaces as an unhandled
   * rejection in a console the owner will never open, and on screen as a Decline
   * button that appeared to work.
   *
   * Every mutation on the page is in this chain, including the ones added since.
   * A peer whose tier LOOKED lowered because the mutation failed silently is the
   * same defect as an approval that did not land, pointed the other way.
   */
  const actionError =
    approving.error ??
    running.error ??
    declining.error ??
    revoking.error ??
    updatingGrant.error ??
    creating.error ??
    linking.error ??
    retiering.error ??
    unlinking.error;

  /**
   * Fire a mutation, and on failure re-read the server rather than guessing.
   *
   * The refetch is the important half. The banner says the action failed; the
   * refetch is what stops the list underneath it from continuing to show the
   * state the owner THOUGHT they had reached — which matters most for the
   * approve/answer chain, where the first mutation can land and the second fail,
   * leaving a real, changed ask behind a failed gesture.
   */
  const runAction = (action: Promise<unknown>, onFailure: () => void = refetchAll): void => {
    void action.catch(() => onFailure());
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

  // The peer roster is passed in, not looked up inside: a grant to a PEER is
  // capped by that peer's trust tier on top of whatever the grant says, so a
  // matrix that cannot see the tier shows a `full` grant as full when the peer
  // is a `stranger` and the answer will be a yes/no.
  const grantGroups: GranteeGroup[] = groupGrants(
    grants.data?.myAskGrants ?? [],
    peers.data?.myPeerLinks ?? [],
  );

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
  } else if (tab === 'compose') {
    // The composer needs three queries to build its recipient list, so it waits
    // for all three rather than offering a partial one. A picker that silently
    // omits somebody is a picker that quietly says "you have no relationship
    // with them", which on this page is a claim, not a loading state.
    if (inbox.error || outbox.error || grants.error) {
      content = <LoadFailure what="the people you can ask" onRetry={refetchAll} />;
    } else if (inbox.loading || outbox.loading || grants.loading || peers.loading) {
      content = <LoadingPage />;
    } else {
      content = (
        <div className="flex flex-col gap-3">
          {sent ? (
            <Card className="flex flex-col gap-1 p-3" role="status">
              <p className="font-medium">Sent.</p>
              <p className="text-muted-foreground text-sm">
                It is in “Sent” now. You will not be told whether a person reads it or a standing rule answers
                it — only whether an answer arrives.
              </p>
            </Card>
          ) : null}
          <AskComposer
            recipients={composeRecipients({
              grants: grants.data?.myAskGrants ?? [],
              inbox: inbox.data?.askInbox ?? [],
              outbox: outbox.data?.askOutbox ?? [],
            })}
            unreachable={unreachablePeers(peers.data?.myPeerLinks ?? [])}
            shapes={COMPOSER_SHAPES}
            busy={creating.loading}
            onSend={(ask) => {
              // Cleared UP FRONT, before the request goes out, and that ordering
              // is the whole control. A green "Sent." belongs to one specific
              // ask, so the moment the owner sends another it must stop
              // referring to the previous one — while the new request is still
              // in flight, not once it resolves. Clearing it in the failure
              // handler instead would leave the old confirmation standing over a
              // send that had not landed yet, which is the same reassuring-lie
              // shape as an error rendered as an empty state.
              setSent(false);
              runAction(
                createAsk({
                  variables: {
                    input: {
                      responderId: ask.responderId,
                      query: { queryType: ask.queryType, dataClass: ask.dataClass, prompt: ask.prompt },
                    },
                  },
                }).then(() => setSent(true)),
                // Nothing to re-read on failure: no ask was created, and the
                // confirmation was already cleared above. Overriding the default
                // `refetchAll` keeps a failed send from firing three pointless
                // reads of the owner's own inbox, grants and history.
                () => undefined,
              );
            }}
          />
        </div>
      );
    }
  } else if (tab === 'grants') {
    if (grants.error) {
      content = <LoadFailure what="your standing grants" onRetry={() => void grants.refetch()} />;
    } else if (grants.loading || peers.loading) {
      // Waits on the PEER roster too. A peer grant rendered before its link
      // resolves shows no ceiling, and a ceiling shown late is a ceiling the
      // owner may have already read past.
      content = <LoadingPage />;
    } else {
      content = grantGroups.length ? (
        <GrantManager
          groups={grantGroups}
          defaultMode="review"
          busy={grantBusy}
          onChangeMode={(grantId, mode) =>
            runAction(updateGrant({ variables: { id: grantId, input: { mode } } }))
          }
          onSetExpiry={(grantId, expiresAt) =>
            runAction(updateGrant({ variables: { id: grantId, input: { expiresAt } } }))
          }
          onRevoke={(grantId) => runAction(revokeGrant({ variables: { id: grantId } }))}
          onOpenHistory={() => setTab('history')}
        />
      ) : (
        <EmptyState message="No standing grants. Every ask comes to you for review." />
      );
    }
  } else if (tab === 'peers') {
    if (peers.error) {
      content = <LoadFailure what="the people you are linked to" onRetry={() => void peers.refetch()} />;
    } else if (peers.loading) {
      content = <LoadingPage />;
    } else {
      content = (
        <PeerManager
          peers={peers.data?.myPeerLinks ?? []}
          busy={peerBusy}
          onChangeTier={(id, trustTier) =>
            runAction(updatePeerLink({ variables: { input: { id, trustTier } } }))
          }
          onRevoke={(id) => runAction(revokePeerLink({ variables: { id } }))}
          onAdd={(input) =>
            runAction(
              createPeerLink({
                variables: {
                  // No `trustTier`. The resolver defaults an omitted tier to
                  // `stranger`, and that default is the safety property — see
                  // CREATE_PEER_LINK.
                  input: {
                    peerHandle: input.peerHandle,
                    memoryEndpoint: input.memoryEndpoint,
                    displayName: input.displayName,
                  },
                },
              }),
            )
          }
        />
      );
    }
  } else if (tab === 'history') {
    if (history.error) {
      content = <LoadFailure what="what you have shared" onRetry={() => void history.refetch()} />;
    } else if (history.loading) {
      content = <LoadingPage />;
    } else {
      const rows = history.data?.askDisclosureHistory ?? [];

      content = rows.length ? (
        <DisclosureHistory
          rows={rows.map((row) => ({
            id: row.id,
            askerId: row.askerId,
            peerHandle: row.peerHandle,
            outcome: row.outcome as AskAuditOutcome,
            disclosedCount: row.disclosedCount,
            consentBasis: row.consentBasis,
            createdAt: row.createdAt as string,
            query: row.query,
          }))}
        />
      ) : (
        <EmptyState message="Nothing has been shared from your Companion yet." />
      );
    }
  } else if (outbox.error) {
    content = <LoadFailure what="the asks you have sent" onRetry={() => void outbox.refetch()} />;
  } else if (outbox.loading) {
    content = <LoadingPage />;
  } else {
    const asked = outbox.data?.askOutbox ?? [];

    content = asked.length ? (
      <div className="flex flex-col gap-2">
        {asked.map((ask) => {
          // `askerVisibleStatus` collapses everything the asker may not know
          // into `delivered`, so `answered` really is "there is something to
          // read" and nothing else on this list ever is.
          const answered = ask.status === 'answered';
          const open = openAnswerId === ask.id;

          return (
            <Card key={ask.id} className="flex flex-col gap-2 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium">{partyLabel(ask.peerHandle, ask.responderId)}</span>
                <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                  {ask.query.prompt}
                </span>
                <Badge variant="secondary">{askStatusLabel(ask.status as AskStatus)}</Badge>
                {answered ? (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-expanded={open}
                    onClick={() => setOpenAnswerId(open ? null : ask.id)}
                  >
                    {open ? 'Hide answer' : 'Read answer'}
                  </Button>
                ) : null}
              </div>

              {answered && open ? (
                <AnswerPanel
                  askId={ask.id}
                  responderName={partyLabel(ask.peerHandle, ask.responderId)}
                  // The viewer is the ASKER on this tab, always. Their copy of
                  // the answer is the narrowed projection, and saying so is what
                  // stops a masked zero reading as "nothing was shared".
                  isResponder={false}
                />
              ) : null}
            </Card>
          );
        })}
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
              ['compose', 'Ask someone'],
              ['outbox', 'Sent'],
              ['grants', 'Who can ask me what'],
              ['peers', 'People I’m linked to'],
              ['history', 'What I’ve shared'],
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
 * Neither is on the wire for a LOCAL grantee — `granteeId` is an opaque
 * GlobalUID and there is no user query to resolve it — so the group is named by
 * the same opaque label used everywhere else rather than by a person's name that
 * would be invented.
 *
 * A PEER grantee is different, and the difference is now readable: `myPeerLinks`
 * resolves `granteePeerLinkId` to a handle and a real trust tier. That tier is
 * the ceiling on everything the grant can ever release, so showing it beside the
 * grant is not decoration — a `full` grant to a `stranger` peer still discloses
 * a yes/no, and an owner reading the grant alone would not know that.
 *
 * `revokedAt` and `active` are carried through rather than dropped. The server's
 * `listForOwner` filters revoked and lapsed rows out today, so in practice every
 * row here is live — but "the server probably filtered it" is not something a
 * consent matrix may assume on the owner's behalf, and the fields are already in
 * the selection set.
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
    revokedAt?: unknown;
    expiresAt?: unknown;
    active?: boolean | null;
  }[],
  peerLinks: readonly {
    id: string;
    peerHandle: string;
    displayName?: string | null;
    trustTier: string;
  }[] = [],
): GranteeGroup[] {
  const byGrantee = new Map<string, GranteeGroup>();
  const links = new Map(peerLinks.map((link) => [link.id, link]));

  for (const row of rows) {
    const key = row.granteeId ?? row.granteePeerLinkId ?? 'unknown';
    const link = row.granteePeerLinkId ? links.get(row.granteePeerLinkId) : undefined;

    let group = byGrantee.get(key);

    if (!group) {
      group = {
        id: key,
        name: link ? link.displayName || link.peerHandle : partyLabel(null, key === 'unknown' ? null : key),
        // THREE cases, not two, because "we do not have it" and "there is none"
        // are different facts and only one of them is stable:
        //   - a peer grantee whose link resolved has a REAL tier, and it is the
        //     ceiling on everything that grant can release;
        //   - a peer grantee whose link did NOT resolve (roster still loading,
        //     or the link was hard-deleted) has a tier this page simply failed
        //     to read — saying "unknown" there would read as "there is no
        //     ceiling", which is the opposite of what a missing read means;
        //   - a LOCAL grantee genuinely has no tier on the wire at all.
        tier: link
          ? peerTrustLabel(link.trustTier)
          : row.granteePeerLinkId
            ? 'tier not loaded'
            : 'tier unknown',
        grants: [],
      };
      byGrantee.set(key, group);
    }

    group.grants.push({
      id: row.id,
      label: grantLabel(row.queryType, row.dataClass),
      mode: row.mode as GranteeGroup['grants'][number]['mode'],
      note: row.purpose ?? undefined,
      expiresAt: asIsoString(row.expiresAt),
      revokedAt: asIsoString(row.revokedAt),
      active: row.active ?? undefined,
    });
  }

  return [...byGrantee.values()];
}

/**
 * A `DateTime` scalar as a string this component can render.
 *
 * Codegen types `DateTime` as `any`, and Apollo hands back whatever the link
 * produced — a string over HTTP, a `Date` from a cache normalizer or a test
 * fixture. Narrowing here rather than at each render site keeps a `Date` from
 * reaching `formatDate` as an object and stringifying as `[object Object]` on
 * the one row the owner most needs to read.
 */
function asIsoString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return null;
}
