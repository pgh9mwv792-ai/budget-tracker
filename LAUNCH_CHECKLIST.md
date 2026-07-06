# Before Public Launch — Checklist

A running list of what to finish before opening Budget Tracker to the public.
The app is solid for **personal use** and much of the original launch list has
since shipped; the items below are what still change when *strangers* can sign
up. Ordered roughly by priority within each section.

Legend: `[x]` done · `[ ]` to do · `[~]` partially done

Reconciled against the repo on 2026-07-05 (migrations through `0015`, Plaid in
**production**, Stripe billing live, Sentry wired, a single `git push` ships the
frontend + edge functions + DB migrations via GitHub Actions).

---

## 1. Security & Privacy

- [x] **Plaid access tokens encrypted at rest.** AES-GCM via
  `encryptToken`/`decryptToken` in `_shared/plaid.ts`; the plaintext column was
  dropped (migrations `0010`, `0011`). `plaid_items`/`plaid_accounts` use
  RLS-with-no-policies + `SECURITY DEFINER` RPCs so tokens never reach the
  browser.
- [~] **Two-factor authentication (2FA / TOTP).**
  - [x] Enroll/manage in Settings (QR code), code prompt at login
    (`MfaChallenge.jsx`, `AuthContext` AAL check).
  - [ ] **Enforce at the database level (RLS), not just in the React UI.** The
    login code screen is still an app-level gate; RLS policies require only
    "logged in," not "passed 2FA." A determined attacker with a stolen password
    + live session could bypass the screen. Fix = add an `aal2` check to the RLS
    policies. Bigger migration; do before public. **← still open, highest-risk.**
  - [ ] **Recovery / backup codes.** If a user loses their authenticator they're
    locked out (currently only fixable via the Supabase dashboard). **← open.**
- [ ] **Enable Supabase "leaked password protection"** (checks new passwords
  against HaveIBeenPwned) and set a sensible minimum password strength. Dashboard
  toggle — confirm it's on for production.
- [~] **Email deliverability (SMTP).** Resend is integrated for the weekly digest
  (`RESEND_API_KEY`), but that's a direct API call from the `weekly-digest`
  function. **Supabase Auth emails** (confirmation, password reset, magic link,
  email change) still go through Supabase's default rate-limited mailer — point
  Supabase Auth SMTP at a real provider before public.
- [ ] **Review all Row Level Security policies** once more with "another user" in
  mind — confirm every user-owned table denies cross-user reads/writes.
- [ ] **Rotate / audit secrets** before launch (Anthropic, Plaid, Stripe,
  `TOKEN_ENCRYPTION_KEY`, service-role). Never commit them; confirm `.env` is
  gitignored. Losing `TOKEN_ENCRYPTION_KEY` makes stored bank tokens
  unrecoverable — back it up securely.

## 2. Cost & Abuse Protection

- [x] **Per-user daily AI request cap** (migration `0005` + check in the `chat`
  function). Counts each Claude call; resets midnight UTC.
- [ ] **Token-spend cap (not just request count).** The cap limits *number* of
  requests; per-message cost still varies. Consider tracking/limiting total
  tokens for tighter bill control.
- [ ] **Global kill-switch / budget alarm** for the Anthropic key (a hard monthly
  ceiling so a surprise spike can't run unbounded).
- [x] **Plaid moved to production.** `PLAID_ENV=production`, individual access
  (up to ~10 live bank connections). Understand per-item pricing and keep the
  connection count in mind before wide exposure.

## 3. Infrastructure & Reliability

- [ ] **Upgrade the Supabase project off the free tier.** Free projects **pause
  after ~1 week of inactivity** (this already bit us once during deploy) — not
  acceptable for public users. Paid plan also raises limits and unlocks backups.
  **← still open.**
- [ ] **Custom domain + HTTPS.** Currently on the `*.vercel.app` subdomain
  (HTTPS is already provided there). A custom domain is optional but nicer.
- [ ] **Backups.** Confirm Supabase automated DB backups are on (paid tiers).
- [x] **Error monitoring.** Sentry is wired (`@sentry/react` in `main.jsx`, crash
  boundary in `AppCrash.jsx`); a no-op when `VITE_SENTRY_DSN` is unset. Confirm
  the DSN is set on production.
- [x] **Migrations + edge functions deploy automatically.** A `git push` to
  `main` triggers `.github/workflows/deploy-functions.yml`, which runs
  `supabase db push` (applies new numbered migrations `0001…0015`) then
  `supabase functions deploy` (all functions). Idempotent SQL means re-runs are
  safe. Watch the Actions tab for the green check.
- [x] **Edge Functions in the repo:** `chat`, `delete-account`, `food-search`,
  `plaid-create-link-token`, `plaid-exchange-public-token`,
  `plaid-sync-transactions`, `plaid-remove-item`, `stripe-create-checkout`,
  `stripe-portal`, `stripe-webhook`, `weekly-digest`. `stripe-webhook` and
  `weekly-digest` run with `verify_jwt = false` (set in `config.toml`) and secure
  themselves with a signature / shared secret.
- [~] **Set all secrets on production.** Needed: `PLAID_*`, `ANTHROPIC_API_KEY`
  (+ optional `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`), `TOKEN_ENCRYPTION_KEY`,
  `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `USDA_API_KEY`,
  `RESEND_API_KEY`, `DIGEST_CRON_SECRET`. Confirm each is present on the live
  project (folded into the "rotate/audit secrets" pass above).

## 4. Testing & Quality

- [~] **Automated test suite (Vitest)** around the pure logic where a silent bug
  would corrupt user data. **Vitest is now installed** (`npm test` → `vitest run`)
  with the first suite landed; the other modules still need coverage. Priorities:
  - [x] `src/lib/receiptMatch.js` — `src/lib/receiptMatch.test.js` covers the
    receipt→transaction confidence matcher: authorized-date extraction (a
    late-posting charge still matches on its descriptor date), coupon-lower and
    tax-higher amount wobble both landing at medium confidence, a same-amount
    different-merchant charge being excluded, the no-match/empty case, and
    already-matched exclusion. (A silent mismatch here links the wrong charge —
    the highest-value thing to cover.)
  - [ ] `src/lib/analysis.js` (recurring detection, merchant keys, rule matching)
  - [ ] `src/lib/foodCost.js` (cost-per-protein, food-spend classification, burn)
  - [ ] `src/lib/csv.js` (export escaping)
  - [ ] `src/lib/chat.js` (`executeTool`, category/goal name resolution)
  **← still open (most modules uncovered).**
- [ ] **Manual cross-browser + mobile pass** (Safari iOS, Chrome Android),
  including the new landing page and share-card download/native share.
- [ ] **Multi-account test** — create two accounts, confirm zero data bleed
  (pairs with the RLS review in §1).
- [x] **Bundle-size / code-splitting.** `App.jsx` lazy-loads every tab body and
  the chat widget, so Recharts/Plaid/receipt code load on demand instead of in
  the entry chunk. Keep an eye on the build's chunk warnings.

## 5. UX & Onboarding (public polish)

- [x] **First-run onboarding + empty states.** `Onboarding.jsx` runs once for new
  users, can seed a realistic month of sample data (incl. logged meals so the
  Food & Money hero populates), and tabs have friendly empty states.
- [x] **Upcoming bills & cash-flow forecast.** `lib/forecast.js` +
  `lib/analysis.js` power the Dashboard's month outlook, insights, weekly
  summary, and "Recurring & upcoming" detection.
- [x] **Signed-out landing page.** `Landing.jsx` renders for signed-out visitors
  (hero, features, Free-vs-Pro pricing, security/trust, footer), swapping to
  `Login` for sign-in/sign-up; auth-return URLs skip straight to Login.
- [x] **Installable PWA shell.** `public/manifest.json` (name, icons, theme
  color, standalone) linked from `index.html`, plus OG/Twitter meta and
  `public/og.png`. **No service worker** — install-to-home-screen shell only
  (offline caching intentionally deferred).
- [ ] **Preferred currency setting.** Still hard-coded `$` everywhere. Doing it
  right means threading a currency/format setting through Dashboard, Budgets,
  Meals, CSV export, share cards, and the AI summary.
- [ ] Minor profile extras if wanted: "member since" date, timezone.

## 6. Legal & Compliance

- [x] **Privacy Policy.** `public/privacy.html` exists and is linked from Login,
  the landing page, and the footer. Review it once more for accuracy re: Plaid +
  Anthropic before launch.
- [ ] **Terms of Service.** Not written yet. **← open.**
- [ ] **Cookie/consent** notice — only needed if analytics are added (none
  currently).
- [x] **Account & data controls.** Full JSON + CSV export (`lib/backup.js`,
  `lib/csv.js`) and permanent account deletion (`delete-account` function) are
  built and wired in Settings. Keep them working.
- [ ] Confirm Plaid's and Anthropic's usage/production terms allow the intended
  public use.

---

## Deferred (intentional — do not build during the refinement pass)

- **Apple Pay domain verification + Stripe wallet enablement.** Stripe Checkout
  works today with cards; enabling Apple Pay / wallets needs the domain verified
  in Stripe. Parked until the refinement pass is over.
- **Scheduling the `weekly-digest` cron.** The `weekly-digest` function, its
  Resend integration, the `DIGEST_CRON_SECRET` gate, and the in-app digest card
  are all built, but the recurring pg_cron → pg_net trigger that actually fires
  it on Sundays is intentionally **not scheduled yet**. Park until the refinement
  pass is over.

## Already shipped (for reference)

- Dark mode, polished UI, code-split bundle.
- Plaid bank + credit-card import in **production**, with the auth-remount bug
  fixed, cursor-based sync, transfer exclusion, and encrypted tokens at rest.
- Auto-categorization (merchant rules), category budgets, savings goals,
  recurring detection, transaction search/filter, CSV + JSON export.
- Meal/macro tracker integrated with spending: cost per 100g protein, cheapest
  protein ranking, USDA food search, receipt + supplement-label scanning, full
  micronutrient capture.
- Credit-score log + card-utilization panel.
- AI assistant (tool-using, app-aware) + private long-term memory, with a
  per-user daily rate limit and a hard stop control.
- Stripe subscription billing (Checkout, Billing Portal, webhook) with Free/Pro
  entitlements gating bank sync + AI.
- 2FA enrollment + login challenge (app-level), account controls (export,
  deletion), profile (display name, avatar, change email/password).
- Weekly digest generation + in-app card + email opt-out (cron not yet scheduled
  — see Deferred).
- Sentry error monitoring, privacy policy, signed-out landing page, shareable
  moment cards, installable PWA shell with OG/Twitter previews.
