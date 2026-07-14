// Button.jsx — single component, all states
// States: default / hover / pressed (scale) / focus-visible / disabled / loading
// Uses CSS variables from your ramp (see notes at bottom for the mapping).

import { Loader2 } from "lucide-react";

const VARIANTS = {
  // Accent ramp: solid fill = step 9, hover = step 10 (Radix convention)
  primary:
    "bg-accent-9 text-white hover:bg-accent-10 border border-transparent",
  // Neutral-heavy secondary: most buttons in a finance app should be this one
  secondary:
    "bg-transparent text-neutral-12 border border-neutral-7 hover:border-neutral-8 hover:bg-neutral-3",
  // Destructive: reserved for real deletion/cancel actions only
  destructive:
    "bg-red-9 text-white hover:bg-red-10 border border-transparent",
  // Ghost: toolbar/icon-adjacent actions
  ghost:
    "bg-transparent text-neutral-11 hover:bg-neutral-3 hover:text-neutral-12 border border-transparent",
};

const SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  children,
  className = "",
  ...props
}) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        // Base: layout, type, radius from your token
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium select-none",

        // Transition: fast and subtle. >200ms in-app reads as sluggish/AI-flashy.
        "transition-[background-color,border-color,transform] duration-150 ease-out",

        // PRESSED state: the shrink you wanted. active: only fires while held.
        // 0.97 is the sweet spot — 0.95 and below reads as toy-like.
        "active:scale-[0.97]",

        // FOCUS-VISIBLE: keyboard ring. Only shows for keyboard nav, not clicks.
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-8 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-1",

        // DISABLED: desaturated + no interaction. pointer-events stays on so
        // the cursor still communicates; disabled attr blocks the click itself.
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 disabled:hover:bg-inherit",

        VARIANTS[variant],
        SIZES[size],
        className,
      ].join(" ")}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {/* Keep label rendered during loading so button width doesn't jump */}
      <span className={loading ? "opacity-70" : ""}>{children}</span>
    </button>
  );
}

/* ============================================================
USAGE

  <Button onClick={save}>Save</Button>
  <Button variant="secondary" onClick={cancel}>Cancel</Button>
  <Button loading={isConnecting} onClick={openPlaid}>Connect bank</Button>
  <Button disabled={!formValid} type="submit">Create budget</Button>

LOADING PATTERN for async actions (Plaid, Stripe, AI logging):

  const [busy, setBusy] = useState(false);
  async function handleConnect() {
    setBusy(true);
    try { await connectBank(); }
    finally { setBusy(false); }   // finally = button never gets stuck
  }
  <Button loading={busy} onClick={handleConnect}>Connect bank</Button>

RAMP MAPPING (if using Radix-style 12-step ramps as CSS vars):
  --neutral-1..12 and --accent-1..12 in :root, then in tailwind.config:
    colors: {
      neutral: { 1: "var(--neutral-1)", ... 12: "var(--neutral-12)" },
      accent:  { 1: "var(--accent-1)",  ... 12: "var(--accent-12)" },
      red:     { 9: "var(--red-9)", 10: "var(--red-10)" },
    }
  Steps used here follow Radix jobs: 3 = hover bg tint, 7/8 = borders,
  9 = solid fill, 10 = solid hover, 11 = muted text, 12 = strong text.

NOTES
- If you're on shadcn's existing Button, don't build this from scratch —
  port these classes into components/ui/button.jsx (the CVA variants file).
  Same result, keeps the rest of shadcn happy.
- Destructive variant: use sparingly. In a finance app, red buttons should
  mean "this deletes/cancels something", never emphasis.
============================================================ */
