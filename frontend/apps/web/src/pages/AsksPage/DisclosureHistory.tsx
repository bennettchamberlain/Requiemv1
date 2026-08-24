import { Badge, Card } from '@ci/shadcn';

import { PersonAvatar } from '@/components/PersonAvatar';

import { scopeSummary } from './askBinding';
import { AskerQuote } from './AskerQuote';
import {
  type AskAuditOutcome,
  disclosureMagnitudeNote,
  outcomeBadge,
  outcomeSentence,
} from './askPresentation';

export interface DisclosureRow {
  id: string;
  /** Resolved by the container — see `partyAvatar` in askBinding.ts. Opaque and never invented. */
  askerName: string;
  /** The asker's photo, when a peer link resolved one. Null renders initials. */
  askerAvatarUrl: string | null;
  outcome: AskAuditOutcome;
  disclosedCount: number;
  consentBasis?: string | null;
  createdAt: string;
  query: { queryType: string; dataClass?: string | null; prompt: string };
}

interface Props {
  rows: readonly DisclosureRow[];
}

/**
 * "What I've shared" — the owner's own record of every ask that reached a
 * terminal outcome.
 *
 * ═══ WHY THIS IS A CONTROL AND NOT A LOG VIEWER ═══
 *
 * `askDisclosureHistory` shipped complete, resolved and tested, and no client
 * ever selected it, so `ci.ask_audit` accumulated rows nobody could read. That
 * is not a missing convenience. Standing consent is the part of this feature
 * that keeps working after the conversation that produced it is over — a grant
 * given under pressure, to a partner or a parent or an employer, keeps
 * answering — and the only thing that makes such a grant survivable is being
 * able to WATCH IT BEING USED. You cannot withdraw consent you cannot see the
 * consequences of.
 *
 * So this list is deliberately built around the three facts that let an owner
 * act rather than merely browse:
 *
 *  - WHO. Every row names the asker, opaquely if that is all the wire supports.
 *  - HOW IT WAS DECIDED. `auto_answered` and `answered` are rendered as
 *    different sentences, not as one "answered" badge, because "a rule you
 *    wrote once released this without asking you" is the outcome an owner needs
 *    to notice and the other is not.
 *  - HOW MUCH. `disclosedCount` is the responder-true number here — this query
 *    is responder-scoped, so unlike the asker's copy of an answer it is not
 *    masked.
 *
 * The prompt goes through {@link AskerQuote} for the same reason it does in the
 * review card: this is somebody else's text, rendered in the owner's own
 * history, and a history entry that reads as the app narrating is worse than a
 * request that does — it is a claim about something that already happened.
 */
export function DisclosureHistory({ rows }: Props) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const who = row.askerName;
        const badge = outcomeBadge(row.outcome);

        return (
          <li key={row.id}>
            <Card className="flex flex-col gap-2 p-4">
              {/* Avatar + name + outcome, one line — the row's identity now
                  reads at a glance instead of as bare, possibly-truncated text. */}
              <div className="flex flex-wrap items-center gap-2">
                <PersonAvatar name={who} avatarUrl={row.askerAvatarUrl} size="xs" />
                <span className="font-medium">{who}</span>
                {/* Text, never colour alone (WCAG 1.4.1). */}
                <Badge variant={badge.variant} className="text-xs">
                  {badge.label}
                </Badge>
                <span className="text-muted-foreground ml-auto text-xs">{formatWhen(row.createdAt)}</span>
              </div>

              <AskerQuote prompt={row.query.prompt} attribution={`${who} asked:`} />

              <div className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                <p>{outcomeSentence(row.outcome, who)}</p>
                <p>
                  {scopeSummary(row.query)} · {disclosureMagnitudeNote(row.outcome, row.disclosedCount)}
                </p>
                {row.consentBasis ? (
                  // The basis is an opaque grant id, and it is still worth
                  // showing: it is the thread an owner pulls to find WHICH rule
                  // did this, and the Grants tab is where they pull it.
                  <p>Under a standing grant you gave — see “Who can ask me what”.</p>
                ) : (
                  <p>No standing grant covered this — you decided it yourself.</p>
                )}
              </div>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A timestamp the owner can act on.
 *
 * Locale-formatted rather than raw ISO, and DATE PLUS TIME rather than a
 * relative "3 days ago": the question this list answers is "did this happen
 * when I think it did", and a relative label is exactly the wrong shape for
 * comparing against a memory of a conversation.
 *
 * An unparseable value falls back to the raw string — showing what is stored
 * beats showing "Invalid Date" on the owner's own audit trail.
 */
function formatWhen(iso: string): string {
  const at = new Date(iso);

  if (Number.isNaN(at.getTime())) {
    return iso;
  }

  return at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
