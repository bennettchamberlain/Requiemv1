import { type ReactNode, type ForwardedRef, forwardRef } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  id: string;
  className?: string;
}

function Portal({ id, className }: PortalProps, forwardedRef: ForwardedRef<HTMLDivElement>) {
  return <div id={id} ref={forwardedRef} className={className} />;
}

interface SlotProps {
  id: string;
  children: ReactNode;
}

function Slot({ id, children }: SlotProps) {
  const elem = document.getElementById(id);

  if (!elem) {
    return null;
  }

  return createPortal(children, elem);
}

const PortalForwarded = forwardRef(Portal);

type PortalComponent = typeof PortalForwarded & {
  Slot: typeof Slot;
};

const AugmentedPortal = PortalForwarded as PortalComponent;

AugmentedPortal.Slot = Slot;

export { AugmentedPortal as Portal };
