import type { LucideIcon } from '@ci/shadcn/icons';
import {
  Cpu,
  Globe,
  HardDrive,
  Key,
  KeyRound,
  MapPin,
  Palette,
  Shield,
  User,
  UserRound,
} from '@ci/shadcn/icons';

export interface SettingsSection {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

/** Shared settings destinations — desktop dialog nav and the mobile profile page. */
export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'preferences', label: 'Preferences', icon: Globe },
  { id: 'autonomy', label: 'Autonomy', icon: Shield },
  { id: 'about-you', label: 'About you', icon: UserRound },
  { id: 'model', label: 'Model', icon: Cpu },
  { id: 'location', label: 'Location', icon: MapPin },
  { id: 'api-keys', label: 'API Keys', icon: KeyRound },
  { id: 'oauth', label: 'OAuth Credentials', icon: Key },
  { id: 'account', label: 'Account', icon: User },
  { id: 'data', label: 'Your data', icon: HardDrive },
];

export function settingsPathToProfile(pathname: string): string {
  const rest = pathname.replace(/^\/settings\/?/, '');

  return rest ? `/profile/${rest}` : '/profile';
}
