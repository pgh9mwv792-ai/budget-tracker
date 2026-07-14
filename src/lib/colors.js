// Bridge between the CSS design tokens (see index.css) and JS that needs raw
// color strings — chiefly Recharts, which takes `fill`/`stroke` props, not
// Tailwind classes. Reading the tokens here (instead of hardcoding hexes) keeps
// charts on the same palette as the rest of the app and lets them follow the
// light/dark theme automatically.

import { useEffect, useState } from 'react'

// The token names JS consumers care about, mapped to friendly keys. Each value
// is a `--color-*` variable defined in index.css (:root and .dark).
const TOKEN_VARS = {
  primary: '--color-primary',
  primaryHover: '--color-primary-hover',
  interactive: '--color-interactive',
  primaryTint: '--color-primary-tint',
  chart1: '--color-chart-1',
  chart2: '--color-chart-2',
  bg: '--color-bg',
  surface: '--color-surface',
  border: '--color-border',
  text: '--color-text',
  textMuted: '--color-text-muted',
  nav: '--color-nav',
  navText: '--color-nav-text',
  success: '--color-success',
  danger: '--color-danger',
  warning: '--color-warning',
}

// Read one resolved token value (e.g. '#1e3a8a') off the document root. Falls
// back to the provided default during SSR/tests where there's no live DOM.
export function themeColor(name, fallback = '') {
  const cssVar = TOKEN_VARS[name] ?? name
  if (typeof window === 'undefined' || !document?.documentElement) return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim() || fallback
}

// Read the whole token set at once, resolved for the current theme.
export function themeColors() {
  const out = {}
  for (const key of Object.keys(TOKEN_VARS)) out[key] = themeColor(key)
  return out
}

// A rotating categorical palette for multi-series charts (e.g. spend-by-category
// pie). Built from the brand + semantic tokens so it recolors with the theme.
export function chartPalette() {
  const c = themeColors()
  return [c.primary, c.interactive, c.warning, c.success, c.danger, c.chart1, c.chart2]
}

// Hook: returns the resolved token colors and re-reads them whenever the theme
// changes, so chart components re-render with fresh colors on a light/dark
// toggle. `themeKey` is the resolved theme string ('light'|'dark') from
// useTheme(); pass it in so the effect re-runs when the .dark class flips.
export function useThemeColors(themeKey) {
  const [colors, setColors] = useState(themeColors)
  useEffect(() => {
    // Read after paint so the .dark class (and thus the CSS vars) is current.
    setColors(themeColors())
  }, [themeKey])
  return colors
}
