# Before Public Launch — Checklist

A running list of what to finish before opening Budget Tracker to the public.
Right now the app is solid for **personal use**; the items below are what change
when *strangers* can sign up. Ordered roughly by priority within each section.

Legend: `[x]` done · `[ ]` to do · `[~]` partially done

---

## 1. Security & Privacy

- [~] **Two-factor authentication (2FA / TOTP).**
  - [x] Enroll/manage in Settings (QR code), code prompt at login.
  - [ ] **Enforce at the database level (RLS), not just in the React UI.** Today
    the login code screen is an app-level gate; RLS policies still only require
    "logged in," not "passed 2FA." A determined attacker with a stolen password
    + live session could bypass the screen. Fix = add an `aal2` check to the RLS
    policies. Bigger migration; do before public.
  - [ ] **Recovery / backup codes.** If a user loses their authenticator they're
    locked out (currently only fixable via the Supabase dashboard).
- [ ] **Enable Supabase "leaked password protection"** (checks new passwords
  against HaveIBeenPwned) and set a sensible minimum password strength.
- [ ] **Email deliverability (SMTP).** Supabase's built-in mailer is rate-limited
  and not meant for production. Hook up a real provider (Resend, Postmark, SES…)
  so email confirmation, password reset, magic links, and email-change actually
  arrive reliably. Personal use tolerates the default; public does not.
- [ ] **Review all Row Level Security policies** once more with "another user"
  in mind — confirm every table denies cross-user reads/writes.
- [ ] **Rotate / audit secrets** before launch (Anthropic key, Plaid keys,
  service-role key). Never commit them; confirm `.env` is gitignored.

## 2. Cost & Abuse Protection

- [x] **Per-user daily AI request cap** (migration 0005 + check in `chat`
  function). Counts each Claude call.
- [ ] **Token-spend cap (not just request count).** Current cap limits *number*
  of requests; a user can't send 10,000 messages, but per-message cost varies.
  Consider also tracking/limiting total tokens for tighter bill control.
- [ ] **Global kill-switch / budget alarm** for the Anthropic key (a hard
  monthly ceiling so a surprise spike can't run unbounded).
- [ ] **Plaid: move from Sandbox to Production.** Requires Plaid approval + env
  switch. Real bank connections cost money per item — understand the pricing and
  add limits before exposing it publicly. (Fine to launch with Plaid disabled.)

## 3. Infrastructure & Reliability

- [ ] **Upgrade the Supabase project off the free tier.** Free projects **pause
  after ~1 week of inactivity** (this already bit us once during deploy) — not
  acceptable for public users. Paid plan also raises limits.
- [ ] **Custom domain + HTTPS** for the app and (optionally) auth emails.
- [ ] **Backups.** Confirm Supabase automated DB backups are on (paid tiers).
- [ ] **Error monitoring** (e.g. Sentry) so you hear about crashes users hit.
- [ ] **Run all migrations on the production project, in order:**
  `0002` … `0006`.
- [ ] **Deploy all Edge Functions:** `chat`, `delete-account`,
  `plaid-create-link-token`, `plaid-exchange-public-token`,
  `plaid-sync-transactions`.
- [ ] **Set all secrets on production:** `ANTHROPIC_API_KEY` (+ optional
  `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`), `PLAID_CLIENT_ID`, `PLAID_SECRET`,
  `PLAID_ENV`.

## 4. Testing & Quality

- [ ] **Automated test suite (Vitest)** around the pure logic where a silent bug
  would corrupt user data:
  - `src/lib/analysis.js` (recurring detection, merchant keys, rule matching)
  - `src/lib/csv.js` (export escaping)
  - `src/lib/chat.js` (`executeTool`, category/goal name resolution)
- [ ] **Manual cross-browser + mobile pass** (Safari iOS, Chrome Android).
- [ ] **Multi-account test** — create two accounts, confirm zero data bleed.
- [ ] Address the **bundle-size build warning** (code-split recharts / plaid via
  dynamic `import()`), so first load isn't a ~840 kB JS download.

## 5. UX & Onboarding (public polish)

- [ ] **First-run onboarding + empty states.** New users land on an empty
  Dashboard; add a guided setup (pick starter categories, optional sample data,
  a few tooltips) and friendlier empty states than "None yet."
- [ ] **Upcoming bills & cash-flow forecast.** Turn the existing recurring-txn
  detector into a forward-looking "due this week" list + projected end-of-month
  balance.
- [ ] **Installable PWA / mobile polish.** Web app manifest + service worker so
  it installs to the home screen; tighten small-screen layouts.
- [ ] **Preferred currency setting.** Currently hard-coded `$` everywhere. Doing
  it right means threading a currency/format setting through Dashboard, Budgets,
  Meals, CSV export, and the AI summary.
- [ ] Minor profile extras if wanted: "member since" date, timezone.

## 6. Legal & Compliance

- [ ] **Privacy Policy** — especially important because the app touches financial
  data (Plaid) and sends chat context to a third party (Anthropic). Disclose what
  data is stored, where, and who it's shared with.
- [ ] **Terms of Service.**
- [ ] **Cookie/consent** notice if you add analytics.
- [ ] **Account & data controls** (already built) satisfy the "export my data" /
  "delete my account" expectations — keep them working. `delete-account` must be
  deployed.
- [ ] Confirm Plaid's and Anthropic's usage terms allow your intended use.

---

## Already done (for reference)

- Dark mode, polished UI.
- Plaid bank import (Sandbox) with the auth-remount bug fixed.
- Auto-categorization (merchant rules), category budgets, recurring detection,
  transaction search/filter, CSV export.
- Meal/macro tracker integrated with spending.
- AI assistant (tool-using, app-aware) + private long-term memory, with a
  per-user daily rate limit.
- 2FA enrollment + login challenge (app-level).
- Account controls: full JSON data export, account deletion.
- Profile: display name, avatar upload, change email, change password.
