import * as React from 'react';

import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';

interface IconButtonProps extends React.ComponentProps<typeof Button> {
  /**
   * Accessible name for the button. Drives both the tooltip text and `aria-label`,
   * so the hover affordance and the screen-reader name can never drift apart.
   */
  label: string;
  /** Overrides the tooltip text when it needs to read differently from `aria-label`. */
  tooltip?: React.ReactNode;
  side?: React.ComponentProps<typeof TooltipContent>['side'];
  align?: React.ComponentProps<typeof TooltipContent>['align'];
  delayDuration?: number;
}

/**
 * An icon-only button that always carries a tooltip.
 *
 * `size="icon"` by default; every other `Button` prop (including `asChild`, to wrap
 * a router `Link`) passes straight through.
 */
function IconButton({
  label,
  tooltip,
  side,
  align,
  delayDuration = 600,
  size = 'icon',
  children,
  ...props
}: IconButtonProps) {
  const button = (
    <Button aria-label={label} size={size} {...props}>
      {children}
    </Button>
  );

  return (
    <Tooltip delayDuration={delayDuration}>
      <TooltipContent side={side} align={align}>
        {tooltip ?? label}
      </TooltipContent>
      {/* A disabled button gets `pointer-events: none` from buttonVariants, which
          swallows the hover the tooltip needs. Anchoring to a wrapper span keeps the
          tooltip working precisely when it matters most — explaining why it's off. */}
      <TooltipTrigger asChild>
        {props.disabled ? <span className="inline-flex">{button}</span> : button}
      </TooltipTrigger>
    </Tooltip>
  );
}

export { IconButton };
export type { IconButtonProps };
