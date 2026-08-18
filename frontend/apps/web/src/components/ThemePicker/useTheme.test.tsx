import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeToggle } from './ThemeToggle';
import { ThemeProvider, useTheme, type ShareableTheme } from './useTheme';

// The canonical storage key the app writes the theme mode under. PR #1644 moved
// this from the legacy `ci-ui-theme` to `vite-ui-theme` as part of the design-system
// normalization; these tests pin that contract so a future rename fails loudly.
const STORAGE_KEY = 'vite-ui-theme';

function wrapper(mode: 'light' | 'dark' | 'system' = 'light') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <ThemeProvider defaultTheme={mode} storageKey={STORAGE_KEY}>
        {children}
      </ThemeProvider>
    );
  };
}

describe('ThemeProvider / useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('applies the .light class to the document root for the light theme', () => {
    renderHook(() => useTheme(), { wrapper: wrapper('light') });

    const root = document.documentElement;
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('setTheme("dark") swaps the root class from .light to .dark', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('light') });

    act(() => result.current.setTheme('dark'));

    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('light')).toBe(false);
  });

  it('persists the selected mode under the canonical storageKey "vite-ui-theme"', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('light') });

    act(() => result.current.setTheme('dark'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => result.current.setTheme('light'));
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('rehydrates the mode from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'dark');

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('light') });

    // defaultTheme is "light" but the persisted value wins.
    expect(result.current.themeState.mode).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('falls back to an inert "system" default context outside a ThemeProvider', () => {
    // useTheme reads a createContext default (never undefined), so a bare hook
    // read yields a usable, inert state rather than throwing.
    const { result } = renderHook(() => useTheme());
    expect(result.current.themeState.mode).toBe('system');
  });
});

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('cycles light -> dark -> system -> light and persists each step', async () => {
    render(<ThemeToggle />, { wrapper: wrapper('light') });

    const button = screen.getByRole('button');

    // light -> dark
    await act(async () => button.click());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // dark -> system
    await act(async () => button.click());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('system');

    // system -> light
    await act(async () => button.click());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('exposes an accessible label that reflects the next mode', () => {
    render(<ThemeToggle />, { wrapper: wrapper('light') });

    // From light, the next action is "Switch to dark mode".
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});

/**
 * Theme export/import as JSON — the highest-risk piece of ColorPicker's
 * download/upload flow: a share file is untrusted input by the time it comes
 * back in, and `importTheme` is the only thing standing between a malformed
 * upload and silently corrupting the stored theme.
 */
describe('exportTheme / importTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('light', 'dark');
  });

  it('captures every effective color for a generated (non-Original) preset', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    act(() => result.current.setColorTheme({ name: 'Crimson Red', baseHue: 0 }));

    const theme = result.current.exportTheme();

    expect(theme.version).toBe(1);
    expect(theme.name).toBe('Crimson Red');
    expect(theme.colorTheme).toEqual({ name: 'Crimson Red', baseHue: 0 });
    // Every CSS variable the picker knows about round-trips as a concrete value.
    expect(theme.colorOverrides.background).toMatch(/^oklch\(/);
    expect(theme.colorOverrides.primary).toMatch(/^oklch\(/);
    expect(() => new Date(theme.exportedAt).toISOString()).not.toThrow();
  });

  it('exports no overrides for the "Original" theme, which has no generated colors of its own', () => {
    // baseHue -3 is the special "use the CSS defaults" theme — generateThemeColors
    // returns {} for it, so with no explicit override set, getEffectiveColor has
    // nothing to report for any variable. A share of this theme carries no colors.
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    const theme = result.current.exportTheme();

    expect(theme.colorTheme.baseHue).toBe(-3);
    expect(theme.colorOverrides).toEqual({});
  });

  it('an explicit override on the Original theme still exports', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    act(() => result.current.setColorVariable('primary', '#ff0000'));

    expect(result.current.exportTheme().colorOverrides).toEqual({ primary: '#ff0000' });
  });

  it('names the export from the argument over the current theme name', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    expect(result.current.exportTheme('My Custom Share').name).toBe('My Custom Share');
  });

  it('falls back to a generated name when the theme has none', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    act(() => result.current.setColorTheme({ name: '', baseHue: 10 }));

    expect(result.current.exportTheme().name).toMatch(/^Custom Theme /);
  });

  it('round-trips a valid export back into an equivalent theme state', () => {
    const source = renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    act(() => source.result.current.setColorTheme({ name: 'Ocean Blue', baseHue: 260 }));
    act(() => source.result.current.setColorVariable('primary', '#123456'));
    const exported = source.result.current.exportTheme();

    // A fresh provider — the recipient of a shared theme file.
    const target = renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    let imported = false;
    act(() => {
      imported = target.result.current.importTheme(exported);
    });

    expect(imported).toBe(true);
    expect(target.result.current.themeState.colorTheme).toEqual({
      name: 'Ocean Blue',
      baseHue: 260,
      isCustom: undefined,
    });
    expect(target.result.current.getEffectiveColor('primary')).toBe('#123456');
    // Persisted, not just held in memory — a reload keeps the imported theme.
    expect(localStorage.getItem('ci-ui-color-theme')).toContain('Ocean Blue');
  });

  it('prefers the export’s own name over the embedded colorTheme.name on import', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    act(() => {
      result.current.importTheme({
        version: 1,
        name: 'Shared as',
        colorTheme: { name: 'Original file name', baseHue: 5 },
        colorOverrides: {},
        exportedAt: new Date().toISOString(),
      });
    });

    expect(result.current.themeState.colorTheme.name).toBe('Shared as');
  });

  it('rejects a theme with the wrong version and leaves the current theme untouched', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });
    act(() => result.current.setColorTheme({ name: 'Forest Green', baseHue: 120 }));

    let imported = true;
    act(() => {
      // @ts-expect-error — deliberately the wrong version, the exact shape a
      // stale or hand-edited share file would carry.
      imported = result.current.importTheme({ version: 2, name: 'x', colorTheme: { name: 'x', baseHue: 1 } });
    });

    expect(imported).toBe(false);
    expect(result.current.themeState.colorTheme.name).toBe('Forest Green');
  });

  it('rejects a theme with no colorTheme at all', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    let imported = true;
    act(() => {
      // @ts-expect-error — malformed on purpose: version is right, everything else is missing.
      imported = result.current.importTheme({ version: 1 });
    });

    expect(imported).toBe(false);
  });

  it('does not throw on a completely malformed payload (e.g. null) and reports failure', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    let imported = true;
    expect(() => {
      act(() => {
        // @ts-expect-error — the shape a `JSON.parse` of garbage could hand back.
        imported = result.current.importTheme(null);
      });
    }).not.toThrow();

    expect(imported).toBe(false);
  });

  it('defaults missing colorOverrides to empty rather than crashing', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper('dark') });

    let imported = false;
    act(() => {
      imported = result.current.importTheme({
        version: 1,
        name: 'No overrides',
        colorTheme: { name: 'No overrides', baseHue: 30 },
        // colorOverrides omitted entirely.
        exportedAt: new Date().toISOString(),
      } as ShareableTheme);
    });

    expect(imported).toBe(true);
    expect(result.current.themeState.colorOverrides).toEqual({});
  });
});
