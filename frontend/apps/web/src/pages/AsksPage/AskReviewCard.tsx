import { Badge, Button, Card } from '@ci/shadcn';
import { ShieldAlert, ShieldCheck } from '@ci/shadcn/icons';

import type { AnswerForm } from '@/graphql/graphql';

import { answerFormLabel, askApproveLabel, askDecisionNote, type AskDecisionState } from './askPresentation';

export interface AskReviewItem {
  id: string;
  /** Entity type, shown so the owner knows what kind of thing is being shared. */
  type: string;
  label: string;
  /** Owner's keep/withhold choice. Defaults to kept. */
  withheld?: boolean;
}

interface Props {
  askerName: string;
  /**
   * What the container can truthfully say about the asker, in its own words.
   *
   * NOT a trust tier, despite the name it still carries from the mock: this is
   * an untyped display string, so whatever is passed is what the badge asserts.
   * The page passes `knownAskerLabel`, which reports the one two-value fact on
   * the wire. Do not pass a tier vocabulary the API never sent.
   */
  tier: string;
  /** The question, in the asker's own words. */
  prompt: string;
  /** The structured ask as SENT, rendered legibly. */
  scopeSummary: string;
  /**
   * What that scope means for the search that will actually run. Required, not
   * optional: a caller who forgets it is a caller who prints a scope with no
   * statement of its breadth, which is the exact defect this pairing closes.
   */
  searchBreadth: string;
  /** The answer preview. Empty for forms that disclose no items. */
  items?: AskReviewItem[];
  /** Where this ask stands — see AskDecisionState. */
  decision: AskDecisionState;
  /** Answer forms the owner can cap this ask at instead of declining. */
  downgrades?: AnswerForm[];
  onToggleItem?: (id: string) => void;
  onApprove: () => void;
  onDowngrade?: (form: AnswerForm) => void;
  onDecline: () => void;
  busy?: boolean;
}

/**
 * One pending ask awaiting the owner's decision.
 *
 * The rule this component exists to enforce is **never approve blind**: the
 * answer preview lives inside the consent surface, so the owner sees exactly
 * what would leave the box before anything does. The "share less" row is
 * deliberately as prominent as Approve — capping the answer should feel as easy
 * as saying yes, not like a buried setting.
 *
 * Two things this card must never do, both of which it did:
 *
 *   - print a scope that reads narrower than the search that runs (hence
 *     `searchBreadth` sitting beside `scopeSummary`, and being required);
 *   - describe an already-authorized ask as a decision the owner still owes
 *     (hence `decision` rather than a bare `unknownAsker` boolean).
 */
export function AskReviewCard({
  askerName,
  tier,
  prompt,
  scopeSummary,
  searchBreadth,
  items = [],
  decision,
  downgrades = [],
  onToggleItem,
  onApprove,
  onDowngrade,
  onDecline,
  busy = false,
}: Props) {
  const kept = items.filter((item) => !item.withheld);
  const shareLabel = items.length > 0 ? `Share ${kept.length} of ${items.length}` : askApproveLabel(decision);
  const preAuthorized = decision === 'pre-authorized';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{askerName}</span>
            <Badge variant={decision === 'unreviewed' ? 'outline' : 'secondary'} className="text-xs">
              {tier}
            </Badge>
            {/* The decision state is its own badge because the tier badge beside
                it answers a different question — "do I know them", not "is this
                still mine to decide". */}
            {preAuthorized ? (
              <Badge variant="secondary" className="text-xs">
                Already authorized
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">“{prompt}”</p>
        </div>
      </div>

      {/* What was asked for, and what that actually costs. The second line is
          never omitted: a data class the responder's box does not recognise
          searches EVERYTHING, and the owner has to be told that before they
          consent, not after. */}
      <div className="text-muted-foreground bg-muted flex flex-col gap-1 rounded-md px-3 py-2 text-xs">
        <p>Would search: {scopeSummary}</p>
        <p>{searchBreadth}</p>
      </div>

      {/* The icon is decorative; the state is carried by the text so it survives
          without colour (WCAG 1.4.1). */}
      <p className="text-muted-foreground flex items-start gap-2 text-xs">
        {preAuthorized ? (
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        ) : (
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        )}
        <span>{askDecisionNote(decision)}</span>
      </p>

      {items.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-muted-foreground mb-1 text-xs">
            {kept.length} of {items.length} selected to share
          </legend>
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={!item.withheld}
                disabled={busy}
                onChange={() => onToggleItem?.(item.id)}
              />
              <span className="truncate">{item.label}</span>
              <span className="text-muted-foreground ml-auto shrink-0 text-xs">{item.type}</span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {downgrades.length > 0 ? (
        <div className="flex flex-col gap-1">
          {/* "at most" is in every label, and stated once here too: the backend
              keeps whichever of this choice and the ask's own shape discloses
              less, so a pick can cap the answer but never enlarge it. */}
          <span className="text-muted-foreground text-xs">
            Or answer with less — each of these caps the answer, and can never widen it
          </span>
          <div className="flex flex-wrap gap-2">
            {downgrades.map((form) => (
              <Button
                key={form}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDowngrade?.(form)}
              >
                {answerFormLabel(form)}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={onApprove} disabled={busy}>
          {shareLabel}
        </Button>
        <Button variant="ghost" onClick={onDecline} disabled={busy}>
          Decline
        </Button>
      </div>
    </Card>
  );
}
