import { Camera, Inbox, MonitorCog, Search, type LucideIcon } from '@ci/shadcn/icons';
import { Link } from 'react-router-dom';

import logo from '@/assets/logo.svg';

export function MobileNavigation() {
  return (
    <div className="flex flex-col border-t bg-secondary">
      <div className="flex flex-row items-center justify-between">
        <NavButton to="/feed" icon={Inbox} label="Feed" />
        <NavButton to="/search" icon={Search} label="Search" />
        <Link to="/chat" aria-label="Chat" className="flex self-stretch p-2 px-4 items-center justify-center">
          <img src={logo} alt="" className="h-12 w-12" />
        </Link>
        <NavButton to="/capture" icon={Camera} label="Capture" />
        <NavButton to="/system" icon={MonitorCog} label="System" />
      </div>
    </div>
  );
}

interface NavButtonProps {
  to: string;
  icon: LucideIcon;
  label: string;
}

export function NavButton({ to, icon: Icon, label }: NavButtonProps) {
  return (
    <Link to={to} className="flex flex-1 flex-col gap-0.5 justify-center items-center p-4 select-none">
      <Icon className="h-6 w-6" />
      <span className="text-xxs">{label}</span>
    </Link>
  );
}
