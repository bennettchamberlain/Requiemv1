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
    // Width matches the drawer (`w-14` / `w-56`). Vertical inset is only `px-2`
    // so this box does not grow the header; the parent cell centers it, which
    // keeps padding above and below the mark the same. Pinning must not add
    // extra padding — that used to shove the rail down.
    <div className={cn('flex items-center px-2 transition-[width] duration-200', pinned ? 'w-56' : 'w-14')}>
      <Tooltip delayDuration={600}>
        <Tooltip.Content>{label}</Tooltip.Content>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-expanded={expanded}
            aria-controls="power-rail"
            onClick={toggle}
            // Glass capsule: `p-1` + a 32px disc = 40px. Max-width is what
            // opens and closes it — same property both ways, so closing is
            // the reverse of opening instead of unmounting the wordmark.
            className={cn(
fix/misc-chat-thread-titles
              'inline-flex h-10 items-center overflow-hidden rounded-full border border-white/55 bg-white/30 p-1 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.7),0_1px_2px_rgba(0,0,0,0.08)] backdrop-blur-md transition-[max-width,padding,gap] duration-200 ease-in-out hover:bg-white/45 dark:border-white/20 dark:bg-white/10 dark:hover:bg-white/20',
              pinned ? 'max-w-52 gap-2 pr-3' : 'max-w-10 gap-0',
            )}
          >
            {/* Full-size mark on a white disc. `max-w-none` defeats Tailwind
              preflight `img { max-width: 100% }` so it stays round. */}
            <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-white -translate-x-[1px]">
              <img src={logo} alt="" className="size-8 max-w-none rounded-full -translate-x-[0px]" />
            </span>
            {/* PINNED, not merely expanded. This button sits in the same `auto`
              grid column as the rail, so a wordmark appearing here widens the
              column and shoves the header and page content sideways — which is
              exactly what a hover-opened drawer must never do. Pinning is the
              one case where a reflow is intended, and permanent. */}
            <span
              aria-hidden={!pinned}
              className="overflow-hidden whitespace-nowrap text-left text-sm font-semibold leading-tight"
            >
              Companion Memory
            </span>
          </button>
        </Tooltip.Trigger>
      </Tooltip>
    </div>
  );
}
