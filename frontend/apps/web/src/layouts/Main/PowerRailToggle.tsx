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
            // Collapsed, the mark is CENTRED in the rail rather than sharing
            // NavLink's left inset. Matching that inset aligns the two left
            // EDGES, which only centres things when the icons are the same
            // width — the mark is 34px against the nav icons' 26px, so it sat
            // 19px from the left against 7px on the right and read as a logo
            // nudged out of its slot. Measured, not eyeballed. The transparent
            // left border goes with it: it is NavLink's active-state gutter,
            // and it only ever pushed this button 2px further off centre.
            className={cn(
              'warp-core flex items-center rounded-md transition hover:bg-accent hover:text-accent-foreground',
              // Collapsed: a 40px square that exactly fills the rail's padded
              // box, with the 32px mark centred inside it. NOT `w-full p-2` —
              // that left a 24px content box, and Tailwind's preflight sets
              // `img { max-width: 100% }`, so the mark was capped to 24px wide
              // while `h-8` held it at 32px tall. It rendered as a vertical
              // ellipse: centred, and squashed.
              pinned
                ? 'w-full gap-2 border-l-2 border-transparent p-2'
                : 'size-10 shrink-0 justify-center p-0',
            )}
          >
            {/* The glow hangs off THIS wrapper, not the button. On the button
              its `inset` was a percentage of the button's width — 40px
              collapsed, but 224px pinned, which turned a compact bloom into a
              rotating ellipse that streaked diagonally across the header and
              out of the rail. Anchored to the mark, both states are identical
              and the light stays where the reactor is.

              `max-w-none` defeats Tailwind's preflight `img { max-width: 100% }`
              directly, so the mark keeps its aspect ratio even if this button is
              ever laid out narrower again. `shrink-0` alone does not do this —
              it stops flex from shrinking the item, but max-width is a separate
              constraint and wins regardless. */}
            {/* 40px disc around a 32px mark: a 4px ring of plasma hugging the
              logo. At the mark's own size the swirl was entirely behind an
              opaque emblem and invisible; any wider and it stops reading as
              part of the mark. Collapsed, the button is 40px too, so the disc
              exactly fills the rail's padded box. */}
            <span className="warp-core relative grid size-10 shrink-0 place-items-center">
              <img src={logo} alt="" className="warp-core-emitter size-8 max-w-none" />
            </span>
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
