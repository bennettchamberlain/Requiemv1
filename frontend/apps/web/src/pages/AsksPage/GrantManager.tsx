import { Badge, Button, Card } from '@ci/shadcn';

import { type GrantMode, grantModeBadge, grantModeLabel } from './askPresentation';

export interface GrantRow {
  id: string;
  /** Data class or ask type this grant covers, in owner-facing words. */
  label: string;
  mode: GrantMode;
  /** Optional scope note, e.g. "digest only · no location". */
  note?: string;
  /** ISO date this grant stops applying, if any. */
  expiresAt?: string | null;
}

export interface GranteeGroup {
  id: string;
  name: string;
  tier: string;
  grants: GrantRow[];
}

interface Props {
  groups: GranteeGroup[];
  /** Posture for anyone without an explicit grant. Always review or block. */
  defaultMode?: Extract<GrantMode, 'review' | 'block'>;
  onChangeMode?: (grantId: string, mode: GrantMode) => void;
  onRevoke?: (grantId: string) => void;
  onAddGrant?: () => void;
  onOpenHistory?: () => void;
}

const MODES: GrantMode[] = ['auto', 'review', 'block'];

/**
 * "Who can ask me what" — the standing-consent matrix.
 *
 * Every grant is one row with three mutually exclusive states, and the fallback
 * for everyone else is stated explicitly rather than left implicit: review is
 * the floor, so a person who has never been granted anything can still only ever
 * reach the owner's inbox. Expiry is shown inline because a grant the owner has
 * forgotten about is the main way standing consent goes wrong.
 */
export function GrantManager({
  groups,
  defaultMode = 'review',
  onChangeMode,
  onRevoke,
  onAddGrant,
  onOpenHistory,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <Card key={group.id} className="flex flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{group.name}</span>
            <Badge variant="secondary" className="text-xs">
              {group.tier}
            </Badge>
          </div>

          <ul className="flex flex-col divide-y">
            {group.grants.map((grant) => {
              const badge = grantModeBadge(grant.mode);

              return (
                <li key={grant.id} className="flex flex-wrap items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{grant.label}</p>
                    {grant.note ? (
                      <p className="text-muted-foreground truncate text-xs">{grant.note}</p>
                    ) : null}
                    {grant.expiresAt ? (
                      <p className="text-muted-foreground text-xs">Expires {grant.expiresAt}</p>
                    ) : null}
                  </div>

                  {/* The badge repeats the mode in words so the state never
                      depends on colour alone (WCAG 1.4.1). */}
                  <Badge variant={badge.variant} className="text-xs">
                    {badge.label}
                  </Badge>

                  <div
                    role="group"
                    aria-label={`Consent for ${grant.label}`}
                    className="flex flex-wrap gap-1"
                  >
                    {MODES.map((mode) => (
                      <Button
                        key={mode}
                        size="sm"
                        variant={grant.mode === mode ? 'default' : 'outline'}
                        aria-pressed={grant.mode === mode}
                        onClick={() => onChangeMode?.(grant.id, mode)}
                      >
                        {grantModeLabel(mode)}
                      </Button>
                    ))}
                    {onRevoke ? (
                      <Button size="sm" variant="ghost" onClick={() => onRevoke(grant.id)}>
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      <Card className="flex flex-wrap items-center gap-2 p-4">
        <span className="text-sm">Everyone else</span>
        <Badge variant="secondary" className="text-xs">
          {grantModeBadge(defaultMode).label}
        </Badge>
        <span className="text-muted-foreground text-xs">Nothing is answered without you, ever.</span>
      </Card>

      <div className="flex flex-wrap gap-2">
        {onAddGrant ? (
          <Button variant="outline" size="sm" onClick={onAddGrant}>
            New grant
          </Button>
        ) : null}
        {onOpenHistory ? (
          <Button variant="ghost" size="sm" onClick={onOpenHistory}>
            What I’ve shared
          </Button>
        ) : null}
      </div>
    </div>
  );
}
