import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'ci-power-rail-expanded';

interface PowerRailContextValue {
  /** Showing labels right now — pinned open, hovered open, or held by a popover. */
  expanded: boolean;
  /** Pinned open by a deliberate choice. Persisted; survives the pointer leaving. */
  pinned: boolean;
  /** Open only because the pointer (or focus) is in it. */
  hovered: boolean;
  /**
   * Held open by an interaction that lives outside the rail DOM (e.g. a
   * portaled colour picker). Without this, moving into the portal fires
   * mouseleave and collapses the rail mid-click.
   */
  holdOpen: boolean;
  /** Pin it open, or unpin it. */
  toggle: () => void;
  setHovered: (hovered: boolean) => void;
  setHoldOpen: (holdOpen: boolean) => void;
}

const PowerRailContext = createContext<PowerRailContextValue | null>(null);

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredExpanded(expanded: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, String(expanded));
  } catch {
    // Private mode / quota — the session still toggles.
  }
}

export function PowerRailProvider({ children }: { children: ReactNode }) {
  // Two reasons the rail is open, and they must not fight. `pinned` is a
  // decision: it survives the pointer leaving, and a reload. `hovered` is a
  // passing intention that expires the moment you move away. Pinned wins, so
  // brushing across a pinned rail never collapses it, and a mouse passing
  // through never overwrites the stored preference.
  //
  // `holdOpen` is a third reason: a portaled popover (Colours) is open, so the
  // pointer left the rail on purpose and must not collapse it underneath.
  const [pinned, setPinned] = useState(readStoredExpanded);
  const [hovered, setHovered] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);

  const toggle = useCallback(() => {
    setPinned((current) => {
      const next = !current;
      writeStoredExpanded(next);

      return next;
    });
  }, []);

  const value = useMemo(
    () => ({
      expanded: pinned || hovered || holdOpen,
      pinned,
      hovered,
      holdOpen,
      toggle,
      setHovered,
      setHoldOpen,
    }),
    [pinned, hovered, holdOpen, toggle],
  );

  return <PowerRailContext.Provider value={value}>{children}</PowerRailContext.Provider>;
}

export function usePowerRail() {
  const context = useContext(PowerRailContext);

  if (!context) {
    throw new Error('usePowerRail must be used within a PowerRailProvider.');
  }

  return context;
}
