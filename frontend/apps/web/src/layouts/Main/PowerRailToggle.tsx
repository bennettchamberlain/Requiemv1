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
  const { expanded, toggle } = usePowerRail();
  const label = expanded ? t('NAV_RAIL_COLLAPSE') : t('NAV_RAIL_EXPAND');

  return (
    <Tooltip delayDuration={600}>
      <Tooltip.Content>{label}</Tooltip.Content>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={expanded}
          aria-controls="power-rail"
          onClick={toggle}
          className={cn(
            'flex items-center rounded-md p-1 transition hover:bg-accent hover:text-accent-foreground',
            expanded && 'w-full gap-2',
          )}
        >
          <img src={logo} alt="" className="h-8 w-8 shrink-0" />
          {expanded && (
            <span className="truncate text-left text-sm font-semibold leading-tight">
              Companion Intelligence
            </span>
          )}
        </button>
      </Tooltip.Trigger>
    </Tooltip>
  );
}
