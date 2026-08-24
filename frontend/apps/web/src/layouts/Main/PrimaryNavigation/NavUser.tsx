import { type ReactNode } from 'react';

import { useDeviceLayout } from '@ci/common';
import { Collapsible, Popover, cn } from '@ci/shadcn';
import { ChevronRight, LogOut, Palette, Settings2 } from '@ci/shadcn/icons';
import { Link, useLocation } from 'react-router-dom';

import { ColorPicker, useTheme } from '@/components/ThemePicker';
import { useAuth } from '@/hooks';

import { usePowerRail } from '../PowerRailContext';

const THEME_MODES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
] as const;

/**
 * Settings, theme, and log out — nested under the Self user tile.
 *
 * Desktop Settings stays an overlay over the page you were on. The phone
 * walks to `/self/settings`, the same hub `/profile` used to be.
 */
export function NavUserMenu() {
  const [, { logout }] = useAuth();
  const location = useLocation();
  const { isMobile } = useDeviceLayout();

  return (
    <div className="flex flex-col gap-1 pt-1">
      <SubRow
        icon={<Settings2 className="h-4 w-4 shrink-0" strokeWidth={1.25} />}
        label="Settings"
        to={isMobile ? '/self/settings' : '/settings/appearance'}
        state={isMobile ? undefined : { backgroundLocation: location }}
      />

      <ThemeSubmenu />

      <SubRow
        icon={<LogOut className="h-4 w-4 shrink-0" strokeWidth={1.25} />}
        label="Log out"
        onClick={logout}
      />
    </div>
  );
}

interface SubRowProps {
  icon: ReactNode;
  label: string;
  to?: string;
  state?: unknown;
  onClick?: () => void;
}

/** A row inside an opened submenu — smaller than a top-level rail entry. */
function SubRow({ icon, label, to, state, onClick }: SubRowProps) {
  const className =
    'flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent hover:text-accent-foreground';

  const leading = (
    <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
      {icon}
    </span>
  );

  if (to != null) {
    return (
      <Link to={to} state={state} aria-label={label} className={className}>
        {leading}
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-label={label} className={className}>
      {leading}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Appearance, nested one level deeper again.
 *
 * Light/Dark/Auto stays three visible choices — a submenu that hides which mode
 * is active is worse than one that shows it — but it lives under Theme rather
 * than occupying a drawer row of its own, and the colour grid opens from here
 * instead of from the rail.
 */
function ThemeSubmenu() {
  const { themeState, setTheme } = useTheme();
  const { setHoldOpen } = usePowerRail();

  return (
    <Collapsible>
      <Collapsible.Trigger className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent hover:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-90">
        <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
          <Palette className="h-4 w-4 shrink-0" strokeWidth={1.25} />
        </span>
        <span className="flex-1 truncate">Theme</span>
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
      </Collapsible.Trigger>

      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-2 py-1">
          {/* Under the Theme label (px-2 + size-8 + gap-3), not a second icon column. */}
          <div className="pl-11 pr-2">
            <div role="radiogroup" aria-label="Theme" className="flex gap-1 rounded-md bg-muted p-1 text-xs">
              {THEME_MODES.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  role="radio"
                  aria-checked={themeState.mode === entry.value}
                  onClick={() => setTheme(entry.value)}
                  className={cn(
                    'flex-1 cursor-pointer rounded-sm px-2 py-1 transition-colors',
                    themeState.mode === entry.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <Popover onOpenChange={setHoldOpen}>
            <Popover.Trigger className="flex w-full cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition hover:bg-accent hover:text-accent-foreground">
              <span className="grid size-8 shrink-0 place-items-center" aria-hidden>
                <Palette className="h-4 w-4 shrink-0" strokeWidth={1.25} />
              </span>
              <span className="truncate">Colours</span>
            </Popover.Trigger>
            <Popover.Content side="right" align="end" className="w-[400px] p-2 pb-0">
              <ColorPicker />
            </Popover.Content>
          </Popover>
        </div>
      </Collapsible.Content>
    </Collapsible>
  );
}
