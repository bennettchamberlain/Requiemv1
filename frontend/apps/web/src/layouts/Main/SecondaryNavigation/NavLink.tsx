import type { ComponentProps, ReactNode } from 'react';

import { Tooltip, cn } from '@ci/shadcn';
import { NavLink as BaseNavLink, useMatch, useResolvedPath } from 'react-router-dom';

import { usePowerRail } from '../PowerRailContext';

interface NavLinkProps extends ComponentProps<typeof BaseNavLink> {
  label: string;
  children: ReactNode;
  badgeCount?: number;
}

export function NavLink({ to, label, children, badgeCount = 0, className, ...props }: NavLinkProps) {
  const { expanded } = usePowerRail();
  const resolvedPath = useResolvedPath(to);

  const match = useMatch({
    path: resolvedPath.pathname,
    end: props.end,
  });

  const isActive = Boolean(match);

  const link = (
    <BaseNavLink
      to={to}
      aria-label={label}
      className={cn(
        'relative border-l-2 border-transparent rounded-md hover:bg-accent hover:text-accent-foreground transition will-change-transform active:scale-95',
        expanded ? 'flex items-center gap-3 px-2 py-2' : 'p-2',
        isActive && 'border-l-primary text-primary hover:bg-accent hover:text-primary dark:shadow-glow-ci',
        className,
      )}
      {...props}
    >
      {children}

      {expanded && <span className="truncate text-sm">{label}</span>}

      {badgeCount > 0 && (
        <span
          className={cn(
            'pointer-events-none inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground',
            // Inset when collapsed: the rail's overflow-y-auto scrollport
            // clips anything that hangs outside the icon cell.
            expanded ? 'ml-auto' : 'absolute right-0 top-0',
          )}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </BaseNavLink>
  );

  // Visible labels make the tooltip redundant — and a bubble on every row
  // fights the expanded rail.
  if (expanded) {
    return link;
  }

  return (
    <Tooltip>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Content side="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}
