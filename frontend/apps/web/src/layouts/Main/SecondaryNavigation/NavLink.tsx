import type { ComponentProps, ReactNode } from 'react';

import { Tooltip, cn } from '@ci/shadcn';
import { NavLink as BaseNavLink, useMatch, useResolvedPath } from 'react-router-dom';

interface NavLinkProps extends ComponentProps<typeof BaseNavLink> {
  label: string;
  children: ReactNode;
}

export function NavLink({ to, label, children, ...props }: NavLinkProps) {
  const resolvedPath = useResolvedPath(to);
  const match = useMatch(resolvedPath.pathname);
  const isActive = Boolean(match);

  return (
    <Tooltip>
      <Tooltip.Trigger asChild>
        <BaseNavLink
          to={to}
          aria-label={label}
          className={cn(
            'p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition will-change-transform active:scale-95',
            isActive &&
              'bg-[#179298] hover:bg-[#1CAFB6] dark:bg-accent dark:hover:text-accent-foreground text-white hover:text-white',
          )}
          {...props}
        >
          {children}
        </BaseNavLink>
      </Tooltip.Trigger>
      <Tooltip.Content side="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}
