import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface PortalProps {
  id: string;
}

function Portal({ id }: PortalProps) {
  return <div id={id} />;
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

export { Portal }
