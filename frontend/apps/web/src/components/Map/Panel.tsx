import { cn } from '@ci/shadcn';

import { type ReactNode, useCallback, useRef } from 'react';
import L from 'leaflet';

import 'leaflet/dist/leaflet.css';

interface Props {
  className?: string;
  children?: ReactNode;
}

export function Panel({ className, children }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      panelRef.current = el;

      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
    }
  }, []);

  return (
    <div
      className={cn('absolute top-0 right-0 h-full w-1/4 cursor-default text-base', className)}
      style={{ zIndex: 1000 }}
      ref={setPanelRef}
    >
      {children}
    </div>
  );
}
