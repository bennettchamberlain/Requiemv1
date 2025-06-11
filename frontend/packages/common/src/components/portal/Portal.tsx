import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  id: string;
  className?: string;
}

function Portal({ id, className }: PortalProps) {
  return <div id={id} className={className} />;
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

Portal.Slot = Slot;

export { Portal };
