import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'ci-power-rail-expanded';

interface PowerRailContextValue {
  expanded: boolean;
  toggle: () => void;
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
  const [expanded, setExpanded] = useState(readStoredExpanded);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      writeStoredExpanded(next);

      return next;
    });
  }, []);

  return <PowerRailContext.Provider value={{ expanded, toggle }}>{children}</PowerRailContext.Provider>;
}

export function usePowerRail() {
  const context = useContext(PowerRailContext);

  if (!context) {
    throw new Error('usePowerRail must be used within a PowerRailProvider.');
  }

  return context;
}
