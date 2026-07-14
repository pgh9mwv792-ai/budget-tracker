# Decisions

Short log of non-obvious, project-wide decisions. Newest first.

## Color design tokens + class-based dark mode (2026-07)

**All colors live in CSS design tokens.** The entire palette is defined in two
blocks at the top of [`src/index.css`](./src/index.css):

- `:root { … }` — the **light** theme (a Deep Navy palette).
- `.dark { … }` — the **dark** theme (navy-based surfaces, brightened blues and
  semantic colors so they read on dark backgrounds).

To recolor the app, edit only those two blocks. Nothing else needs to change.

**How it reaches components (Tailwind v4).** We're on Tailwind v4 (no
`tailwind.config.js`; config lives in CSS). An `@theme inline { … }` block maps
each `--color-*` token into Tailwind so semantic utilities are generated:
`bg-primary`, `bg-surface`, `text-text`, `text-text-muted`, `border-border`,
`bg-primary-tint`, `text-interactive`, `bg-nav`, `text-nav-text`,
`text-success`, `text-danger`, `text-warning`, etc. `inline` makes each utility
reference the live `var(--color-…)`, so overriding a token in `.dark`
automatically recolors every utility — **components need no `dark:` prefix for
colors.** Reserve `dark:` for non-color tweaks (e.g. shadows) only.

**Token reference:**

| Group | Tokens |
| --- | --- |
| Brand | `--color-primary`, `--color-primary-hover`, `--color-interactive`, `--color-primary-tint`, `--color-chart-1`, `--color-chart-2` |
| Neutrals | `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-nav`, `--color-nav-text` |
| Semantic | `--color-success` (positive / under budget), `--color-danger` (negative / overspent / errors), `--color-warning` (approaching limit) |

Keep the semantic colors strictly meaningful: green only for positive/under
budget, red only for negative/overspent/errors, amber only for
approaching-limit warnings. Never use a raw hue (`bg-blue-600`) in a component —
use the semantic token (`bg-primary`).

**Dark mode is class-based.**
- The `.dark` class is toggled on `<html>` by
  [`src/contexts/ThemeContext.jsx`](./src/contexts/ThemeContext.jsx). It stores a
  preference under `localStorage['theme']` = `'light' | 'dark' | 'system'`;
  `'system'` follows the OS `prefers-color-scheme` live.
- A tiny inline script in [`index.html`](./index.html) `<head>` applies `.dark`
  **before React mounts** to avoid a white flash on load. It must stay in sync
  with `getInitialMode()` in ThemeContext (same storage key + resolution logic).
- The theme control (Light / Dark / System) lives in **Settings → Appearance**;
  the nav bar keeps a one-tap light/dark toggle.

**Charts.** Recharts takes color props, not Tailwind classes, so chart colors
come from [`src/lib/colors.js`](./src/lib/colors.js), which reads the tokens via
`getComputedStyle`. Chart components call `useThemeColors(theme)` (passing the
resolved theme from `useTheme()`) so they re-read and recolor on a theme toggle.
Add chart colors there, not as hardcoded hexes.

### Migration status (complete)

The token system, dark-mode infrastructure, theme toggle, and chart helper are
complete, and **all app components have now been migrated** off hardcoded
Tailwind hues onto the semantic tokens. A repo-wide sweep for `*-slate/gray/
emerald/red/green/amber/sky/blue-<n>` color classes returns zero hits (outside
code comments), and `npx vite build` is green. `dark:` prefixes remain only for
non-color tweaks.

**Intentional literal-color exceptions (do NOT "fix" these):**

- `ShareCard.jsx` `drawCard()` — canvas hexes are left literal so the exported
  PNG looks identical regardless of the user's theme (an image shouldn't flip
  with dark mode).
- `Login.jsx` — the Google "G" logo SVG keeps its official brand hexes.
- `Settings.jsx` — the toggle **knob** stays `bg-white` (a `bg-surface` knob is
  near-invisible on the dark off-track), and the 2FA **QR code** keeps a white
  background so it stays scannable.
- Always-dark control chips (Chat "Stop"/remove-attachment, scanner overlays)
  use `bg-nav`/`text-nav-text` to stay dark in both themes by design.

**Known minor caveat:** a few destructive-action fills use `text-white` on
`bg-danger` (e.g. Settings delete button). White-on-red passes AA in light mode
but is borderline on the brightened dark-mode red. If we want it airtight, add an
`--color-on-danger` token (mirroring `--color-on-primary`) later; left as-is for
now.

**Migration rules (settled on the Dashboard, apply to remaining views):**

- The token palette makes the brand accent **navy/blue** (`--color-primary`),
  whereas much of the current UI uses an **emerald** accent. Emerald used as a
  *brand/navigation* accent → `primary`/`interactive`; emerald used for
  *positive/success meaning* (net positive, under budget, cheaper protein) →
  `success` (stays green).
- The ~6 slate text shades collapse onto the two text tokens: strong text
  (slate-700/800/900) → `text-text`; muted text (slate-400/500/600) →
  `text-text-muted`.
- Surfaces `bg-white dark:bg-slate-900` → `bg-surface`; borders/dividers → `border-border`/`divide-border`; tracks → `bg-border`.
- Tinted status panels use the semantic token at low opacity, e.g. success
  `border-success/30 bg-success/10`, danger `…/10`, warning `…/10`, info →
  `border-primary/30 bg-primary/10` (or `bg-primary-tint`).

The "Food & money" hero uses the **navy** brand accent like the rest of the
Dashboard (panel `bg-primary/10`, dot `bg-primary`, headline number + CTA links
`interactive`) — **no green anywhere in it.** Its grocery-vs-eating-out split bar
uses `bg-danger` (eating out) + `bg-primary` (groceries): two hues that stay
distinct in **both** light and dark. Note `--color-primary` and `--color-chart-2`
resolve to the *same* blue (`#3b82f6`) in dark mode, so never pair those two in a
single bar/chart (this bit us once — the bar looked solid until we split it into
two genuinely different tokens).
