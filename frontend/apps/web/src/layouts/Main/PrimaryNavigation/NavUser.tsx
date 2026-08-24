import { useMemo, type ReactNode } from 'react';

import { Collapsible, Popover, Tooltip, cn } from '@ci/shadcn';
import { ChevronRight, LogOut, Palette, Settings2 } from '@ci/shadcn/icons';
import { Link, useLocation } from 'react-router-dom';

import { PersonAvatar } from '@/components/PersonAvatar';
import { ColorPicker, useTheme } from '@/components/ThemePicker';
import { useAuth, useCurrentUser } from '@/hooks';

import { usePowerRail } from '../PowerRailContext';

const THEME_MODES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'Auto' },
] as const;

/**
 * You, and everything that belongs to you, under one entry.
 *
 * This was a dropdown behind an avatar, then briefly five flat rows at the
 * bottom of the drawer — which traded a hidden menu for a permanent wall of
 * settings sitting level with the places you actually work. It is one row that
 * opens now: your name, and under it the things that are yours.
 *
 * Theme and colours live inside Settings rather than beside it, because that is
 * what they are — settings — and the drawer should not spend three of its rows
 * on appearance.
 */

/** Settings, theme, and log out — the body of the account entry. */
export function NavUserMenu() {
  const [, { logout }] = useAuth();
  const location = useLocation();

  return (
    <div className="flex flex-col gap-1 pt-1">
      {/* `backgroundLocation` keeps Settings an overlay over the page you were
          on, which is what it has always been. */}
      <SubRow
        icon={<Settings2 className="h-4 w-4 shrink-0" strokeWidth={1.25} />}
        label="Settings"
        to="/settings/appearance"
        state={{ backgroundLocation: location }}
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

export function NavUser() {
  const { expanded } = usePowerRail();
  const { user } = useCurrentUser();
  const location = useLocation();

  const currentUser = useMemo(
    () => ({
      name: user?.name || user?.email || 'User',
      email: user?.email || '',
      avatarUrl: user?.avatarUrl,
    }),
    [user],
  );

  // size="sm" is 32px — the exact h-8 w-8 this rendered before PersonAvatar
  // existed, so this is a no-op for anyone who already has a photo.
  const avatar = <PersonAvatar name={currentUser.name} avatarUrl={currentUser.avatarUrl} size="sm" />;

  // Collapsed, the account is the avatar and one destination: Settings. The
  // rest is reachable the moment the drawer opens, and a 56px rail is no place
  // for a nested accordion.
  if (!expanded) {
    return (
      <Tooltip delayDuration={600}>
        <Tooltip.Trigger asChild>
          <Link
            to="/settings/appearance"
            state={{ backgroundLocation: location }}
            aria-label={currentUser.name}
            className="flex items-center justify-center rounded-md p-1 transition hover:bg-accent"
          >
            {avatar}
          </Link>
        </Tooltip.Trigger>
        <Tooltip.Content side="right">{currentUser.name}</Tooltip.Content>
      </Tooltip>
    );
  }

  return (
    <Collapsible>
      <Collapsible.Trigger className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-accent hover:text-accent-foreground [&[data-state=open]>svg:last-child]:rotate-90">
        {/* size-8 matches Help's leading cell, so this name and "Help" share
            one left edge rather than padding off different icon widths. */}
        {avatar}
        <span className="grid min-w-0 flex-1 text-left text-sm leading-tight">
          <span className="truncate font-medium">{currentUser.name}</span>
          <span className="truncate text-xs text-muted-foreground">{currentUser.email}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-200" />
      </Collapsible.Trigger>

      {/*
        No pl-6 — submenu icons share the avatar's size-8 column. Height
        animates with Radix's --radix-collapsible-content-height.
      */}
      <Collapsible.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <NavUserMenu />
      </Collapsible.Content>
    </Collapsible>
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
