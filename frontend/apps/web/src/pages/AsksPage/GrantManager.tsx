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
  /**
   * ISO date the owner withdrew this grant, if they have. A row carrying one is
   * NOT in force, whatever `mode` says.
   */
  revokedAt?: string | null;
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
  /**
   * One sentence from the container about what this matrix cannot show, e.g. a
   * liveness field the wire does not carry yet. Rendered where the owner reads
   * the grants, not in a comment nobody sees.
   */
  caveat?: string;
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
 *
 * ═══ INERT CONTROLS ARE WORSE THAN ABSENT ONES ═══
 *
 * The three mode buttons render whether or not `onChangeMode` is wired, and for
 * the whole life of this page it was not: tapping "Blocked" moved nothing,
 * persisted nothing, and left a button looking pressed. On a consent surface
 * that is the most dangerous possible failure — the owner believes they have
 * revoked access they still grant. So when no handler is supplied the buttons
 * are `disabled` and the reason is printed beside them. The current mode stays
 * legible either way, because the badge on the row carries it in words.
 */
export function GrantManager({
  groups,
  defaultMode = 'review',
  onChangeMode,
  onRevoke,
  onAddGrant,
  onOpenHistory,
  caveat,
}: Props) {
  const canChangeMode = onChangeMode != null;

  return (
    <div className="flex flex-col gap-3">
      {canChangeMode && caveat == null ? null : (
        <Card className="flex flex-col gap-1 p-3 text-xs">
          {canChangeMode ? null : (
            <p>
              Changing a grant’s mode isn’t available yet. To change one, revoke it and create a replacement —
              revoking works.
            </p>
          )}
          {caveat ? <p className="text-muted-foreground">{caveat}</p> : null}
        </Card>
      )}

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
              // A revoked grant is history, not consent. Its mode still describes
              // what it USED to allow, so the row keeps the label but must never
              // present it as something currently in force.
              const revoked = grant.revokedAt != null;

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
                    {revoked ? (
                      <p className="text-muted-foreground text-xs">
                        Revoked {grant.revokedAt} — no longer in force
                      </p>
                    ) : null}
                  </div>

                  {/* The badge repeats the mode in words so the state never
                      depends on colour alone (WCAG 1.4.1). */}
                  <Badge variant={revoked ? 'outline' : badge.variant} className="text-xs">
                    {revoked ? 'Revoked' : badge.label}
                  </Badge>

                  {revoked ? null : (
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
                          disabled={!canChangeMode}
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
                  )}
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
