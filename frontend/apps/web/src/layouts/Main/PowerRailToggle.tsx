import { Tooltip, cn } from '@ci/shadcn';
import { useTranslation } from 'react-i18next';

import logo from '@/assets/logo.png';

import { usePowerRail } from './PowerRailContext';

/**
 * The home control. It used to be a link — either to `/feed` or to the
 * marketing site — which meant the one button that looks like "this app"
 * never did the one thing the chrome needs: open and close the rail.
 */
export function PowerRailToggle() {
  const { t } = useTranslation();
  const { expanded, pinned, toggle } = usePowerRail();
  const label = expanded ? t('NAV_RAIL_COLLAPSE') : t('NAV_RAIL_EXPAND');

  return (
    // This sits directly above the drawer, in the same grid column, so it has
    // to be exactly as wide and exactly as inset — otherwise the boundary
    // between the two shows as a step. `p-2` and the width pair are copied
    // from the rail deliberately: they are one edge, drawn twice.
    <div className={cn('flex items-center p-2 transition-[width] duration-200', pinned ? 'w-56' : 'w-14')}>
      <Tooltip delayDuration={600}>
        <Tooltip.Content>{label}</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={expanded}
            aria-controls="power-rail"
            onClick={toggle}
            // `p-2` and the transparent left border are copied from `NavLink`,
            // so the logo lands on the same vertical as every icon beneath it.
            // With `p-1` and no border it sat 6px to their left, which reads as
            // a wonky logo rather than as a padding bug.
            className={cn(
              'flex items-center rounded-md border-l-2 border-transparent p-2 transition hover:bg-accent hover:text-accent-foreground',
              pinned && 'w-full gap-2',
            )}
          >
            <img src={logo} alt="" className="h-8 w-8 shrink-0" />
            {/* PINNED, not merely expanded. This button sits in the same `auto`
              grid column as the rail, so a wordmark appearing here widens the
              column and shoves the header and page content sideways — which is
              exactly what a hover-opened drawer must never do. Pinning is the
              one case where a reflow is intended, and permanent. */}
            {pinned && (
              <span className="truncate text-left text-sm font-semibold leading-tight">Companion Memory</span>
            )}
          </button>
        </Tooltip.Trigger>
      </Tooltip>
    </div>
  );
}
