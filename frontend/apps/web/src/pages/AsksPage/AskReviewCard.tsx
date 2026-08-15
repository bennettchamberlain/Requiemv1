import { Badge, Button, Card } from '@ci/shadcn';
import { ShieldAlert } from '@ci/shadcn/icons';

import { type DisclosureRung, rungLabel } from './askPresentation';

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
  /** Relationship tier, shown so the owner can weigh the request. */
  tier: string;
  /** The question, in the asker's own words. */
  prompt: string;
  /** What would actually be searched — the structured ask, rendered legibly. */
  scopeSummary: string;
  /** The answer preview. Empty for forms that disclose no items. */
  items?: AskReviewItem[];
  /** True when this asker has no matching grant (the quarantined case). */
  unknownAsker?: boolean;
  /** Coarser rungs the owner can answer at instead of declining. */
  downgrades?: DisclosureRung[];
  onToggleItem?: (id: string) => void;
  onApprove: () => void;
  onDowngrade?: (rung: DisclosureRung) => void;
  onDecline: () => void;
  busy?: boolean;
}

/**
 * One pending ask awaiting the owner's decision.
 *
 * The rule this component exists to enforce is **never approve blind**: the
 * answer preview lives inside the consent surface, so the owner sees exactly
 * what would leave the box before anything does. The "share less" row is
 * deliberately as prominent as Approve — answering at a coarser rung should feel
 * as easy as saying yes, not like a buried setting.
 */
export function AskReviewCard({
  askerName,
  tier,
  prompt,
  scopeSummary,
  items = [],
  unknownAsker = false,
  downgrades = [],
  onToggleItem,
  onApprove,
  onDowngrade,
  onDecline,
  busy = false,
}: Props) {
  const kept = items.filter((item) => !item.withheld);
  const shareLabel = items.length > 0 ? `Share ${kept.length} of ${items.length}` : 'Answer';

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{askerName}</span>
            <Badge variant={unknownAsker ? 'outline' : 'secondary'} className="text-xs">
              {tier}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1 text-sm">“{prompt}”</p>
        </div>
      </div>

      {/* What would be searched — the structured ask, shown back in plain words. */}
      <p className="text-muted-foreground bg-muted rounded-md px-3 py-2 text-xs">
        Would search: {scopeSummary}
      </p>

      {unknownAsker ? (
        // Quarantine for askers with no standing grant. The icon is decorative;
        // the warning is carried by the text so it survives without colour.
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>No standing grant covers this request. Nothing is shared unless you approve it.</span>
        </p>
      ) : null}

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
          <span className="text-muted-foreground text-xs">Or answer with less</span>
          <div className="flex flex-wrap gap-2">
            {downgrades.map((rung) => (
              <Button
                key={rung}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => onDowngrade?.(rung)}
              >
                {rungLabel(rung)}
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
