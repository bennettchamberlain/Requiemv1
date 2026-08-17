import { useMemo } from 'react';

import { Avatar, DropdownMenu, Tooltip } from '@ci/shadcn';
import { ListTodo, LogOut, SunMoon, Settings2, Palette } from '@ci/shadcn/icons';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';

import { useFeatures } from '@/common/feature';
import { useTheme, ColorPicker } from '@/components/ThemePicker';
import { useAuth, useCurrentUser } from '@/hooks';

export function NavUser() {
  const { t } = useTranslation();
  const [, { logout }] = useAuth();
  const { user } = useCurrentUser();
  const { themeState, setTheme } = useTheme();
  const location = useLocation();

  const { isFeatureEnabled } = useFeatures();

  const currentUser = useMemo(
    () => ({
      name: user?.name || user?.email || 'User',
      email: user?.email || '',
      onboarded: user?.onboarded || false,
      avatar: '/avatars/shadcn.jpg',
    }),
    [user],
  );

  const initials = useMemo(() => {
    const parts = currentUser.name.trim().split(/\s+/);

    const first = parts[0][0] ?? '';
    const last = parts.length > 1 ? parts[parts.length - 1][0] : '';

    return (first + last).toUpperCase();
  }, [currentUser]);

  return (
    <DropdownMenu modal={false}>
      <Tooltip delayDuration={600}>
        <Tooltip.Content>{t('NAV_ACCOUNT')}</Tooltip.Content>
        {/* Avatar renders a span, so as the bare trigger it took no role and no
            tab stop — the account menu was unreachable by keyboard, and an
            aria-label on it would have been ignored. The button supplies both.
            Dropdown trigger outermost so its `data-state` is not overwritten by
            the tooltip's. */}
        <DropdownMenu.Trigger asChild>
          <Tooltip.Trigger asChild>
            <button type="button" aria-label={t('NAV_ACCOUNT')} className="rounded-full cursor-pointer">
              <Avatar className="h-9 w-9 rounded-full select-none">
                <Avatar.Image src={currentUser.avatar} alt={currentUser.name} />
                <Avatar.Fallback>{initials}</Avatar.Fallback>
              </Avatar>
            </button>
          </Tooltip.Trigger>
        </DropdownMenu.Trigger>
      </Tooltip>
      <DropdownMenu.Content className="min-w-56 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <DropdownMenu.Group>
          <DropdownMenu.Label className="p-0 font-normal select-none">
            <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
              <Avatar className="h-8 w-8 rounded-lg">
                <Avatar.Image src={currentUser.avatar} alt={currentUser.name} />
                <Avatar.Fallback className="rounded-lg">{initials}</Avatar.Fallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{currentUser.name}</span>
                <span className="truncate text-xs">{currentUser.email}</span>
              </div>
            </div>
          </DropdownMenu.Label>
        </DropdownMenu.Group>

        <DropdownMenu.Separator />

        {/* The entries carry visible labels, so each tooltip says what the entry leads
            to rather than repeating it. side="left" puts the bubble on the open side of
            this right-aligned menu, and pointer-events-none stops it stealing hover. */}
        <DropdownMenu.Group>
          <Tooltip delayDuration={600}>
            <Tooltip.Content side="left" className="pointer-events-none">
              {t('NAV_ACCOUNT_SETTINGS')}
            </Tooltip.Content>
            <Tooltip.Trigger asChild>
              <DropdownMenu.Item asChild>
                <Link to="/settings/appearance" state={{ backgroundLocation: location }}>
                  <Settings2 />
                  Settings
                </Link>
              </DropdownMenu.Item>
            </Tooltip.Trigger>
          </Tooltip>

          {/* Connections used to sit here, which is why nobody found it: this
              is the menu you open to change a setting, not to add data. It is
              now Sources in the primary sidebar. */}

          {isFeatureEnabled('jobs.page') && (
            <Tooltip delayDuration={600}>
              <Tooltip.Content side="left" className="pointer-events-none">
                {t('NAV_ACCOUNT_JOBS')}
              </Tooltip.Content>
              <Tooltip.Trigger asChild>
                <DropdownMenu.Item asChild>
                  <Link to="/jobs">
                    <ListTodo />
                    Jobs
                  </Link>
                </DropdownMenu.Item>
              </Tooltip.Trigger>
            </Tooltip>
          )}
        </DropdownMenu.Group>

        <DropdownMenu.Separator />

        {/* No tooltips on the two sub-triggers: they style on data-[state=open], which
            Tooltip.Trigger would overwrite, and hovering them already opens the submenu
            that shows the choices — a bubble would only fight it. */}
        <DropdownMenu.Group>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <SunMoon />
              Theme
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent>
              <DropdownMenu.RadioGroup
                value={themeState.mode}
                onValueChange={(value: string) => setTheme(value as 'light' | 'dark' | 'system')}
              >
                <DropdownMenu.RadioItem value="light">Light</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="dark">Dark</DropdownMenu.RadioItem>
                <DropdownMenu.RadioItem value="system">System</DropdownMenu.RadioItem>
              </DropdownMenu.RadioGroup>
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>

          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger>
              <Palette />
              Colors
            </DropdownMenu.SubTrigger>
            <DropdownMenu.SubContent className="w-[400px] p-2 pb-0">
              <ColorPicker />
            </DropdownMenu.SubContent>
          </DropdownMenu.Sub>
        </DropdownMenu.Group>

        <DropdownMenu.Separator />

        <Tooltip delayDuration={600}>
          <Tooltip.Content side="left" className="pointer-events-none">
            {t('NAV_ACCOUNT_LOGOUT')}
          </Tooltip.Content>
          <Tooltip.Trigger asChild>
            <DropdownMenu.Item onClick={logout}>
              <LogOut />
              Log out
            </DropdownMenu.Item>
          </Tooltip.Trigger>
        </Tooltip>
      </DropdownMenu.Content>
    </DropdownMenu>
  );
}
