import { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'dark' | 'light' | 'system';

interface ColorTheme {
  name: string;
  baseHue: number;
  isCustom?: boolean;
}

interface TexturePattern {
  id: string;
  name: string;
  description: string;
  size: string;
  repeat?: string;
  blendMode?: string;
  attachment?: 'fixed' | 'local';
  build: (palette: TexturePalette, opacity: number) => string | string[];
}

interface TexturePalette {
  background: string;
  accent: string;
  contrast: string;
  muted: string;
}

interface ThemeState {
  mode: Theme;
  colorTheme: ColorTheme;
  textureId: string;
  textureOpacity: number;
}

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  defaultColorTheme?: ColorTheme;
  defaultTextureId?: string;
  defaultTextureOpacity?: number;
  storageKey?: string;
  colorStorageKey?: string;
  textureStorageKey?: string;
  textureOpacityStorageKey?: string;
};

type ThemeProviderState = {
  themeState: ThemeState;
  setTheme: (theme: Theme) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  setCustomColor: (hue: number) => void;
  setTexture: (textureId: string) => void;
  setTextureOpacity: (opacity: number) => void;
};

// Preset color themes
export const PRESET_THEMES: ColorTheme[] = [
  { name: 'Ocean Blue', baseHue: 260 },
  { name: 'Crimson Red', baseHue: 0 },
  { name: 'Velvety Purple', baseHue: 280 },
  { name: 'Forest Green', baseHue: 120 },
  { name: 'Sunset Orange', baseHue: 30 },
  { name: 'Midnight Indigo', baseHue: 240 },
  { name: 'Dark Gray', baseHue: -1 }, // Special value for dark neutral
  { name: 'Light Gray', baseHue: -2 }, // Special value for light neutral
  { name: 'Original', baseHue: -3 }, // Special value for original theme
];

export const DEFAULT_TEXTURE_ID = 'none';

const svgTexture = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const formatOpacity = (value: number) => clamp01(value).toFixed(3);

export const TEXTURE_PATTERNS: TexturePattern[] = [
  {
    id: DEFAULT_TEXTURE_ID,
    name: 'None',
    description: 'Solid background only',
    size: 'auto',
    build: () => 'none',
  },
  {
    id: 'micro-dots',
    name: 'Micro Dots',
    description: 'Offset dots inspired by Hero Patterns "Polka Dots".',
    size: '48px 48px',
    build: ({ accent }, opacity) => {
      const alpha = (value: number) => formatOpacity(value * opacity);

      return svgTexture(`
        <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
          <circle cx="10" cy="10" r="2.2" fill="${accent}" fill-opacity="${alpha(0.14)}" />
          <circle cx="34" cy="10" r="2.2" fill="${accent}" fill-opacity="${alpha(0.1)}" />
          <circle cx="22" cy="24" r="2.2" fill="${accent}" fill-opacity="${alpha(0.18)}" />
          <circle cx="46" cy="24" r="2.2" fill="${accent}" fill-opacity="${alpha(0.08)}" />
          <circle cx="10" cy="38" r="2.2" fill="${accent}" fill-opacity="${alpha(0.12)}" />
          <circle cx="34" cy="38" r="2.2" fill="${accent}" fill-opacity="${alpha(0.16)}" />
          <circle cx="-2" cy="24" r="2.2" fill="${accent}" fill-opacity="${alpha(0.1)}" />
        </svg>
      `);
    },
  },
  {
    id: 'cross-hatch',
    name: 'Cross Hatch',
    description: 'Tight grid reminiscent of "Cross Stripes".',
    size: '64px 64px',
    build: ({ contrast }, opacity) =>
      svgTexture(`
        <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
          <path d="M0 16H64M0 32H64M0 48H64" stroke="${contrast}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="1.2" />
          <path d="M16 0V64M32 0V64M48 0V64" stroke="${contrast}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="1.2" />
        </svg>
      `),
  },
  {
    id: 'diagonal-lines',
    name: 'Diagonal Lines',
    description: 'Classic diagonal stripes.',
    size: '56px 56px',
    build: ({ accent }, opacity) =>
      svgTexture(`
        <svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
          <path d="M-14 56L56 -14M-2 56L56 -2M10 56L56 10M22 56L56 22" stroke="${accent}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="6" stroke-linecap="round" />
        </svg>
      `),
  },
  {
    id: 'overlapping-circles',
    name: 'Overlapping Circles',
    description: 'Concentric arcs inspired by "Overlapping Circles".',
    size: '96px 96px',
    build: ({ accent, muted }, opacity) =>
      svgTexture(`
        <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" fill="none">
          <circle cx="48" cy="48" r="42" stroke="${accent}" stroke-opacity="${formatOpacity(0.08 * opacity)}" stroke-width="1.5" />
          <circle cx="0" cy="48" r="42" stroke="${muted}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="1.5" />
          <circle cx="96" cy="48" r="42" stroke="${muted}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="1.5" />
          <circle cx="48" cy="0" r="42" stroke="${accent}" stroke-opacity="${formatOpacity(0.08 * opacity)}" stroke-width="1.5" />
          <circle cx="48" cy="96" r="42" stroke="${accent}" stroke-opacity="${formatOpacity(0.08 * opacity)}" stroke-width="1.5" />
        </svg>
      `),
  },
  {
    id: 'isometric-cubes',
    name: 'Isometric Cubes',
    description: 'Geometric tessellation inspired by "Cubes".',
    size: '96px 96px',
    build: ({ contrast, accent }, opacity) =>
      svgTexture(`
        <svg width="96" height="96" viewBox="0 0 96 96" xmlns="http://www.w3.org/2000/svg" fill="none">
          <path d="M16 32L32 16L48 32L32 48L16 32Z" stroke="${contrast}" stroke-opacity="${formatOpacity(0.18 * opacity)}" stroke-width="1" />
          <path d="M48 32L64 16L80 32L64 48L48 32Z" stroke="${accent}" stroke-opacity="${formatOpacity(0.14 * opacity)}" stroke-width="1" />
          <path d="M32 48L48 32L64 48L48 64L32 48Z" stroke="${contrast}" stroke-opacity="${formatOpacity(0.18 * opacity)}" stroke-width="1" />
          <path d="M0 32L16 16L32 32L16 48L0 32Z" stroke="${accent}" stroke-opacity="${formatOpacity(0.16 * opacity)}" stroke-width="1" />
          <path d="M64 48L80 32L96 48L80 64L64 48Z" stroke="${accent}" stroke-opacity="${formatOpacity(0.16 * opacity)}" stroke-width="1" />
          <path d="M32 16L48 0L64 16L48 32L32 16Z" stroke="${accent}" stroke-opacity="${formatOpacity(0.14 * opacity)}" stroke-width="1" />
          <path d="M32 64L48 48L64 64L48 80L32 64Z" stroke="${contrast}" stroke-opacity="${formatOpacity(0.18 * opacity)}" stroke-width="1" />
        </svg>
      `),
  },
  {
    id: 'contour-lines',
    name: 'Contour Lines',
    description: 'Organic waves reminiscent of "Topography".',
    size: '160px 160px',
    build: ({ contrast }, opacity) =>
      svgTexture(`
        <svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg" fill="none">
          <path d="M-10 40C30 20 70 20 110 40C150 60 190 60 230 40" stroke="${contrast}" stroke-opacity="${formatOpacity(0.08 * opacity)}" stroke-width="1.4" />
          <path d="M-10 80C20 60 80 60 110 80C140 100 200 100 230 80" stroke="${contrast}" stroke-opacity="${formatOpacity(0.12 * opacity)}" stroke-width="1.4" />
          <path d="M-10 120C20 100 80 100 110 120C140 140 200 140 230 120" stroke="${contrast}" stroke-opacity="${formatOpacity(0.08 * opacity)}" stroke-width="1.4" />
          <path d="M-10 0C30 -20 70 -20 110 0C150 20 190 20 230 0" stroke="${contrast}" stroke-opacity="${formatOpacity(0.06 * opacity)}" stroke-width="1.4" />
        </svg>
      `),
  },
  {
    id: 'corner-crosses',
    name: 'Corner Crosses',
    description: 'Cross motifs hugging the corners for subtle framing.',
    size: '40px 40px',
    build: ({ accent }, opacity) =>
      svgTexture(`
        <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
          <g fill-rule="evenodd" fill="${accent}" fill-opacity="${formatOpacity(0.4 * opacity)}">
            <path d="M0 38.59l2.83-2.83 1.41 1.41L1.41 40H0v-1.41z" />
            <path d="M0 1.4l2.83 2.83 1.41-1.41L1.41 0H0v1.41z" />
            <path d="M38.59 40l-2.83-2.83 1.41-1.41L40 38.59V40h-1.41z" />
            <path d="M40 1.41l-2.83 2.83-1.41-1.41L38.59 0H40v1.41z" />
            <path d="M20 18.6l2.83-2.83 1.41 1.41L21.41 20l2.83 2.83-1.41 1.41L20 21.41l-2.83 2.83-1.41-1.41L18.59 20l-2.83-2.83 1.41-1.41L20 18.59z" />
          </g>
        </svg>
      `),
  },
];

// Generate theme colors based on base hue and mode
function generateThemeColors(baseHue: number, isDark: boolean = true): Record<string, string> {
  // Handle special neutral themes
  if (baseHue === -1) {
    // Dark Gray theme (lighter than before)
    return generateNeutralTheme(isDark, 'dark');
  }

  if (baseHue === -2) {
    // Light Gray theme (lighter than before)
    return generateNeutralTheme(isDark, 'light');
  }

  if (baseHue === -3) {
    // Original theme - return empty object to use CSS defaults
    // This lets the original CSS :root and .dark selectors handle the theming
    return {};
  }

  if (isDark) {
    // Dark mode color generation
    return {
      // Backgrounds - very dark with subtle color
      background: `oklch(0.129 0.042 ${baseHue})`,
      card: `oklch(0.208 0.042 ${(baseHue + 5) % 360})`,
      popover: `oklch(0.208 0.042 ${(baseHue + 5) % 360})`,

      // Interactive elements
      primary: `oklch(0.929 0.013 ${(baseHue - 5) % 360})`,
      secondary: `oklch(0.279 0.041 ${baseHue})`,
      accent: `oklch(0.279 0.041 ${(baseHue + 10) % 360})`,
      muted: `oklch(0.279 0.041 ${baseHue})`,

      // Destructive (use red-orange regardless of base)
      destructive: `oklch(0.704 0.191 22.216)`,

      // Borders and inputs - keep some color but subtle
      border: `oklch(1 0 0 / 10%)`,
      input: `oklch(1 0 0 / 15%)`,
      ring: `oklch(0.551 0.027 ${(baseHue + 4) % 360})`,

      // Text colors
      foreground: `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'card-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'popover-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'primary-foreground': `oklch(0.208 0.042 ${(baseHue + 5) % 360})`,
      'secondary-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'accent-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'muted-foreground': `oklch(0.704 0.04 ${(baseHue - 4) % 360})`,

      // Chart colors - spread across color wheel for contrast
      'chart-1': `oklch(0.488 0.243 ${baseHue})`,
      'chart-2': `oklch(0.696 0.17 ${(baseHue + 120) % 360})`,
      'chart-3': `oklch(0.769 0.188 ${(baseHue + 240) % 360})`,
      'chart-4': `oklch(0.627 0.265 ${(baseHue + 60) % 360})`,
      'chart-5': `oklch(0.645 0.246 ${(baseHue + 300) % 360})`,

      // Sidebar colors
      sidebar: `oklch(0.208 0.042 ${(baseHue + 5) % 360})`,
      'sidebar-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'sidebar-primary': `oklch(0.488 0.243 ${baseHue})`,
      'sidebar-primary-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'sidebar-accent': `oklch(0.279 0.041 ${baseHue})`,
      'sidebar-accent-foreground': `oklch(0.984 0.003 ${(baseHue - 15) % 360})`,
      'sidebar-border': `oklch(1 0 0 / 10%)`,
      'sidebar-ring': `oklch(0.551 0.027 ${(baseHue + 4) % 360})`,
    };
  } else {
    // Light mode color generation
    return {
      // Backgrounds - very light with subtle color
      background: `oklch(0.98 0.005 ${baseHue})`,
      card: `oklch(0.95 0.008 ${(baseHue + 5) % 360})`,
      popover: `oklch(0.95 0.008 ${(baseHue + 5) % 360})`,

      // Interactive elements
      primary: `oklch(0.35 0.12 ${baseHue})`,
      secondary: `oklch(0.85 0.02 ${(baseHue + 5) % 360})`,
      accent: `oklch(0.85 0.02 ${(baseHue + 10) % 360})`,
      muted: `oklch(0.85 0.02 ${(baseHue + 5) % 360})`,

      // Destructive
      destructive: `oklch(0.577 0.245 27.325)`,

      // Borders and inputs
      border: `oklch(0.9 0.01 ${(baseHue + 5) % 360})`,
      input: `oklch(0.9 0.01 ${(baseHue + 5) % 360})`,
      ring: `oklch(0.45 0.08 ${(baseHue + 4) % 360})`,

      // Text colors
      foreground: `oklch(0.15 0.02 ${(baseHue + 10) % 360})`,
      'card-foreground': `oklch(0.15 0.02 ${(baseHue + 10) % 360})`,
      'popover-foreground': `oklch(0.15 0.02 ${(baseHue + 10) % 360})`,
      'primary-foreground': `oklch(0.98 0.005 ${(baseHue - 5) % 360})`,
      'secondary-foreground': `oklch(0.35 0.08 ${baseHue})`,
      'accent-foreground': `oklch(0.35 0.08 ${baseHue})`,
      'muted-foreground': `oklch(0.5 0.04 ${(baseHue + 4) % 360})`,

      // Chart colors - vibrant but lighter
      'chart-1': `oklch(0.55 0.18 ${baseHue})`,
      'chart-2': `oklch(0.6 0.15 ${(baseHue + 120) % 360})`,
      'chart-3': `oklch(0.65 0.14 ${(baseHue + 240) % 360})`,
      'chart-4': `oklch(0.5 0.2 ${(baseHue + 60) % 360})`,
      'chart-5': `oklch(0.58 0.17 ${(baseHue + 300) % 360})`,

      // Sidebar colors
      sidebar: `oklch(0.95 0.008 ${(baseHue + 5) % 360})`,
      'sidebar-foreground': `oklch(0.15 0.02 ${(baseHue + 10) % 360})`,
      'sidebar-primary': `oklch(0.35 0.12 ${baseHue})`,
      'sidebar-primary-foreground': `oklch(0.98 0.005 ${(baseHue - 5) % 360})`,
      'sidebar-accent': `oklch(0.85 0.02 ${(baseHue + 10) % 360})`,
      'sidebar-accent-foreground': `oklch(0.35 0.08 ${baseHue})`,
      'sidebar-border': `oklch(0.9 0.01 ${(baseHue + 5) % 360})`,
      'sidebar-ring': `oklch(0.45 0.08 ${(baseHue + 4) % 360})`,
    };
  }
}

// Generate neutral theme colors (grays)
function generateNeutralTheme(isDark: boolean, variant: 'dark' | 'light'): Record<string, string> {
  if (isDark) {
    if (variant === 'dark') {
      // Dark neutral theme - lighter grays than before
      return {
        background: 'oklch(0.12 0 0)', // Lighter than 0.08
        card: 'oklch(0.16 0 0)', // Lighter than 0.12
        popover: 'oklch(0.16 0 0)',
        primary: 'oklch(0.88 0 0)', // Slightly darker than 0.9
        secondary: 'oklch(0.22 0 0)', // Lighter than 0.18
        accent: 'oklch(0.22 0 0)',
        muted: 'oklch(0.22 0 0)',
        destructive: 'oklch(0.704 0.191 22.216)',
        border: 'oklch(0.24 0 0)', // Lighter than 0.2
        input: 'oklch(0.24 0 0)',
        ring: 'oklch(0.5 0 0)',
        foreground: 'oklch(0.96 0 0)', // Slightly darker than 0.98
        'card-foreground': 'oklch(0.96 0 0)',
        'popover-foreground': 'oklch(0.96 0 0)',
        'primary-foreground': 'oklch(0.12 0 0)',
        'secondary-foreground': 'oklch(0.96 0 0)',
        'accent-foreground': 'oklch(0.96 0 0)',
        'muted-foreground': 'oklch(0.6 0 0)',
        'chart-1': 'oklch(0.4 0 0)',
        'chart-2': 'oklch(0.5 0 0)',
        'chart-3': 'oklch(0.6 0 0)',
        'chart-4': 'oklch(0.7 0 0)',
        'chart-5': 'oklch(0.8 0 0)',
        sidebar: 'oklch(0.16 0 0)',
        'sidebar-foreground': 'oklch(0.96 0 0)',
        'sidebar-primary': 'oklch(0.4 0 0)',
        'sidebar-primary-foreground': 'oklch(0.96 0 0)',
        'sidebar-accent': 'oklch(0.22 0 0)',
        'sidebar-accent-foreground': 'oklch(0.96 0 0)',
        'sidebar-border': 'oklch(0.24 0 0)',
        'sidebar-ring': 'oklch(0.5 0 0)',
      };
    } else {
      // Light neutral theme in dark mode - much lighter warm grays
      return {
        background: 'oklch(0.18 0.003 60)', // Lighter than 0.15
        card: 'oklch(0.23 0.005 60)', // Lighter than 0.2
        popover: 'oklch(0.23 0.005 60)',
        primary: 'oklch(0.82 0.008 60)', // Lighter than 0.85
        secondary: 'oklch(0.28 0.008 60)', // Lighter than 0.25
        accent: 'oklch(0.28 0.008 60)',
        muted: 'oklch(0.28 0.008 60)',
        destructive: 'oklch(0.704 0.191 22.216)',
        border: 'oklch(0.33 0.005 60)', // Lighter than 0.3
        input: 'oklch(0.33 0.005 60)',
        ring: 'oklch(0.5 0.012 60)',
        foreground: 'oklch(0.92 0.005 60)', // Lighter than 0.95
        'card-foreground': 'oklch(0.92 0.005 60)',
        'popover-foreground': 'oklch(0.92 0.005 60)',
        'primary-foreground': 'oklch(0.18 0.003 60)',
        'secondary-foreground': 'oklch(0.92 0.005 60)',
        'accent-foreground': 'oklch(0.92 0.005 60)',
        'muted-foreground': 'oklch(0.68 0.008 60)', // Lighter than 0.65
        'chart-1': 'oklch(0.4 0.015 60)',
        'chart-2': 'oklch(0.5 0.015 60)',
        'chart-3': 'oklch(0.6 0.015 60)',
        'chart-4': 'oklch(0.7 0.015 60)',
        'chart-5': 'oklch(0.8 0.015 60)',
        sidebar: 'oklch(0.23 0.005 60)',
        'sidebar-foreground': 'oklch(0.92 0.005 60)',
        'sidebar-primary': 'oklch(0.4 0.015 60)',
        'sidebar-primary-foreground': 'oklch(0.92 0.005 60)',
        'sidebar-accent': 'oklch(0.28 0.008 60)',
        'sidebar-accent-foreground': 'oklch(0.92 0.005 60)',
        'sidebar-border': 'oklch(0.33 0.005 60)',
        'sidebar-ring': 'oklch(0.5 0.012 60)',
      };
    }
  } else {
    // Light mode neutral themes
    if (variant === 'dark') {
      // Dark neutral in light mode - cool grays
      return {
        background: 'oklch(0.98 0.002 240)',
        card: 'oklch(0.96 0.003 240)',
        popover: 'oklch(0.96 0.003 240)',
        primary: 'oklch(0.25 0.01 240)',
        secondary: 'oklch(0.92 0.005 240)',
        accent: 'oklch(0.92 0.005 240)',
        muted: 'oklch(0.92 0.005 240)',
        destructive: 'oklch(0.577 0.245 27.325)',
        border: 'oklch(0.88 0.005 240)',
        input: 'oklch(0.88 0.005 240)',
        ring: 'oklch(0.45 0.02 240)',
        foreground: 'oklch(0.15 0.008 240)',
        'card-foreground': 'oklch(0.15 0.008 240)',
        'popover-foreground': 'oklch(0.15 0.008 240)',
        'primary-foreground': 'oklch(0.98 0.002 240)',
        'secondary-foreground': 'oklch(0.25 0.01 240)',
        'accent-foreground': 'oklch(0.25 0.01 240)',
        'muted-foreground': 'oklch(0.45 0.01 240)',
        'chart-1': 'oklch(0.3 0.02 240)',
        'chart-2': 'oklch(0.4 0.02 240)',
        'chart-3': 'oklch(0.5 0.02 240)',
        'chart-4': 'oklch(0.6 0.02 240)',
        'chart-5': 'oklch(0.7 0.02 240)',
        sidebar: 'oklch(0.96 0.003 240)',
        'sidebar-foreground': 'oklch(0.15 0.008 240)',
        'sidebar-primary': 'oklch(0.25 0.01 240)',
        'sidebar-primary-foreground': 'oklch(0.98 0.002 240)',
        'sidebar-accent': 'oklch(0.92 0.005 240)',
        'sidebar-accent-foreground': 'oklch(0.25 0.01 240)',
        'sidebar-border': 'oklch(0.88 0.005 240)',
        'sidebar-ring': 'oklch(0.45 0.02 240)',
      };
    } else {
      // Light neutral in light mode - very light warm whites
      return {
        background: 'oklch(0.995 0.001 60)', // Even lighter than 0.99
        card: 'oklch(0.985 0.002 60)', // Lighter than 0.97
        popover: 'oklch(0.985 0.002 60)',
        primary: 'oklch(0.32 0.015 60)', // Slightly darker than 0.3
        secondary: 'oklch(0.96 0.003 60)', // Lighter than 0.94
        accent: 'oklch(0.96 0.003 60)',
        muted: 'oklch(0.96 0.003 60)',
        destructive: 'oklch(0.577 0.245 27.325)',
        border: 'oklch(0.92 0.003 60)', // Lighter than 0.9
        input: 'oklch(0.92 0.003 60)',
        ring: 'oklch(0.5 0.015 60)',
        foreground: 'oklch(0.22 0.005 60)', // Slightly lighter than 0.2
        'card-foreground': 'oklch(0.22 0.005 60)',
        'popover-foreground': 'oklch(0.22 0.005 60)',
        'primary-foreground': 'oklch(0.995 0.001 60)',
        'secondary-foreground': 'oklch(0.32 0.015 60)',
        'accent-foreground': 'oklch(0.32 0.015 60)',
        'muted-foreground': 'oklch(0.52 0.008 60)', // Lighter than 0.5
        'chart-1': 'oklch(0.35 0.02 60)',
        'chart-2': 'oklch(0.45 0.02 60)',
        'chart-3': 'oklch(0.55 0.02 60)',
        'chart-4': 'oklch(0.65 0.02 60)',
        'chart-5': 'oklch(0.75 0.02 60)',
        sidebar: 'oklch(0.985 0.002 60)',
        'sidebar-foreground': 'oklch(0.22 0.005 60)',
        'sidebar-primary': 'oklch(0.32 0.015 60)',
        'sidebar-primary-foreground': 'oklch(0.995 0.001 60)',
        'sidebar-accent': 'oklch(0.96 0.003 60)',
        'sidebar-accent-foreground': 'oklch(0.32 0.015 60)',
        'sidebar-border': 'oklch(0.92 0.003 60)',
        'sidebar-ring': 'oklch(0.5 0.015 60)',
      };
    }
  }
}

const resolveTexturePattern = (textureId: string) =>
  TEXTURE_PATTERNS.find((pattern) => pattern.id === textureId) ?? TEXTURE_PATTERNS[0];

export const DEFAULT_TEXTURE_PALETTE: TexturePalette = {
  background: 'oklch(0.129 0 0)',
  accent: 'oklch(0.65 0.1 250)',
  contrast: 'oklch(0.95 0 0)',
  muted: 'oklch(0.4 0 0)',
};

const extractPalette = (styles: CSSStyleDeclaration): TexturePalette => {
  const read = (key: string, fallback: string) => styles.getPropertyValue(key).trim() || fallback;

  return {
    background: read('--background', DEFAULT_TEXTURE_PALETTE.background),
    accent: read('--primary', read('--accent', DEFAULT_TEXTURE_PALETTE.accent)),
    contrast: read('--muted-foreground', read('--foreground', DEFAULT_TEXTURE_PALETTE.contrast)),
    muted: read('--muted', read('--secondary', DEFAULT_TEXTURE_PALETTE.muted)),
  };
};

const getPaletteFromRoot = (root: HTMLElement): TexturePalette => {
  const styles = window.getComputedStyle(root);

  return extractPalette(styles);
};

const applyTextureToRoot = (root: HTMLElement, textureId: string, opacity: number) => {
  const texture = resolveTexturePattern(textureId);

  if (texture.id === DEFAULT_TEXTURE_ID) {
    root.style.removeProperty('--texture-image');
    root.style.removeProperty('--texture-size');
    root.style.removeProperty('--texture-repeat');
    root.style.removeProperty('--texture-attachment');
    root.style.removeProperty('--texture-blend-mode');

    return;
  }

  const palette = getPaletteFromRoot(root);
  const normalizedOpacity = clamp01(opacity);
  const layers = texture.build(palette, normalizedOpacity);
  const image = Array.isArray(layers) ? layers.join(', ') : layers;

  if (!image || image === 'none') {
    root.style.removeProperty('--texture-image');
    root.style.removeProperty('--texture-size');
    root.style.removeProperty('--texture-repeat');
    root.style.removeProperty('--texture-attachment');
    root.style.removeProperty('--texture-blend-mode');

    return;
  }

  root.style.setProperty('--texture-image', image);
  root.style.setProperty('--texture-size', texture.size);
  root.style.setProperty('--texture-repeat', texture.repeat ?? 'repeat');
  root.style.setProperty('--texture-attachment', texture.attachment ?? 'local');

  if (texture.blendMode) {
    root.style.setProperty('--texture-blend-mode', texture.blendMode);
  } else {
    root.style.removeProperty('--texture-blend-mode');
  }
};

export const readTexturePalette = (): TexturePalette | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  return getPaletteFromRoot(window.document.documentElement);
};

export const buildTextureBackground = (textureId: string, palette: TexturePalette, opacity: number) => {
  const texture = resolveTexturePattern(textureId);
  if (texture.id === DEFAULT_TEXTURE_ID) {
    return 'none';
  }

  const layers = texture.build(palette, clamp01(opacity));

  return Array.isArray(layers) ? layers.join(', ') : layers;
};

const initialState: ThemeProviderState = {
  themeState: {
    mode: 'system',
    colorTheme: PRESET_THEMES[0],
    textureId: DEFAULT_TEXTURE_ID,
    textureOpacity: 0.35,
  },
  setTheme: () => null,
  setColorTheme: () => null,
  setCustomColor: () => null,
  setTexture: () => null,
  setTextureOpacity: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  defaultColorTheme = PRESET_THEMES[0],
  defaultTextureId = DEFAULT_TEXTURE_ID,
  defaultTextureOpacity = 0.35,
  storageKey = 'ci-ui-theme',
  colorStorageKey = 'ci-ui-color-theme',
  textureStorageKey = 'ci-ui-texture',
  textureOpacityStorageKey = 'ci-ui-texture-opacity',
}: ThemeProviderProps) {
  const [themeState, setThemeState] = useState<ThemeState>(() => {
    // Try to get theme from localStorage first
    const storedTheme = localStorage.getItem(storageKey) as Theme;
    const storedColorTheme = localStorage.getItem(colorStorageKey);
    const storedTexture = localStorage.getItem(textureStorageKey);
    const storedTextureOpacity = localStorage.getItem(textureOpacityStorageKey);

    let colorTheme = defaultColorTheme;
    if (storedColorTheme) {
      try {
        colorTheme = JSON.parse(storedColorTheme);
      } catch {
        // Fallback to default if parsing fails
      }
    }

    const resolvedTexture = resolveTexturePattern(storedTexture || defaultTextureId);
    const resolvedOpacity = (() => {
      const fallback = clamp01(defaultTextureOpacity);
      if (!storedTextureOpacity) {
        return fallback;
      }

      const parsed = Number(storedTextureOpacity);

      return Number.isFinite(parsed) ? clamp01(parsed) : fallback;
    })();

    return {
      mode: storedTheme || defaultTheme,
      colorTheme,
      textureId: resolvedTexture.id,
      textureOpacity: resolvedOpacity,
    };
  });

  useEffect(() => {
    const root = window.document.documentElement;

    // Remove any existing theme classes
    root.classList.remove('light', 'dark');

    let effectiveMode = themeState.mode;
    if (themeState.mode === 'system') {
      effectiveMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    root.classList.add(effectiveMode);

    if (themeState.colorTheme.baseHue === -3) {
      // Original theme - remove all custom properties to use CSS defaults
      // This allows the original :root and .dark CSS rules to take effect
      const allColorKeys = [
        'background',
        'foreground',
        'card',
        'card-foreground',
        'popover',
        'popover-foreground',
        'primary',
        'primary-foreground',
        'secondary',
        'secondary-foreground',
        'muted',
        'muted-foreground',
        'accent',
        'accent-foreground',
        'destructive',
        'border',
        'input',
        'ring',
        'chart-1',
        'chart-2',
        'chart-3',
        'chart-4',
        'chart-5',
        'sidebar',
        'sidebar-foreground',
        'sidebar-primary',
        'sidebar-primary-foreground',
        'sidebar-accent',
        'sidebar-accent-foreground',
        'sidebar-border',
        'sidebar-ring',
      ];
      allColorKeys.forEach((key) => {
        root.style.removeProperty(`--${key}`);
      });
    } else {
      // Apply custom color theme for both light and dark modes
      const isDark = effectiveMode === 'dark';
      const colors = generateThemeColors(themeState.colorTheme.baseHue, isDark);
      Object.entries(colors).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
      });
    }

    applyTextureToRoot(root, themeState.textureId, themeState.textureOpacity);
  }, [themeState]);

  const setTheme = (theme: Theme) => {
    localStorage.setItem(storageKey, theme);
    setThemeState((prev) => ({ ...prev, mode: theme }));
  };

  const setColorTheme = (colorTheme: ColorTheme) => {
    localStorage.setItem(colorStorageKey, JSON.stringify(colorTheme));
    setThemeState((prev) => ({ ...prev, colorTheme }));
  };

  const setCustomColor = (hue: number) => {
    const customTheme: ColorTheme = {
      name: `Custom ${hue}°`,
      baseHue: hue,
      isCustom: true,
    };
    setColorTheme(customTheme);
  };

  const setTexture = (textureId: string) => {
    const resolved = resolveTexturePattern(textureId).id;
    localStorage.setItem(textureStorageKey, resolved);
    setThemeState((prev) => ({ ...prev, textureId: resolved }));
  };

  const setTextureOpacity = (opacity: number) => {
    const normalized = clamp01(opacity);
    localStorage.setItem(textureOpacityStorageKey, normalized.toString());
    setThemeState((prev) => ({ ...prev, textureOpacity: normalized }));
  };

  const value = {
    themeState,
    setTheme,
    setColorTheme,
    setCustomColor,
    setTexture,
    setTextureOpacity,
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }

  return context;
};
