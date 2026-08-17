import { Tooltip } from '@ci/shadcn';
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
          className="rounded-md p-1 transition hover:bg-accent hover:text-accent-foreground"
        >
          <img src={logo} alt="" className="h-8 w-8" />
        </button>
      </Tooltip.Trigger>
    </Tooltip>
  );
}
