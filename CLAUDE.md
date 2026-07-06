# Budget Tracker — project instructions for Claude

Personal budgeting web app (heading toward public release). **Full architecture
reference is in [`HANDOFF.md`](./HANDOFF.md) — read it before non-trivial work.**

## Who I'm working with
The owner is a **self-taught beginner with no prior coding experience**. Explain
things in plain, non-technical language. For any dashboard/terminal/Supabase
step, give clear, numbered, click-by-click instructions — don't assume prior
knowledge.

## Stack (quick)
React 19 + Vite 8 + Tailwind v4 + Recharts · Supabase (Postgres/RLS, Auth,
Storage, Deno Edge Functions) · Plaid (**production**, individual access) ·
Anthropic Claude API (only via the `chat` edge function).

- Live: `https://budget-tracker-rose-mu.vercel.app/`
- GitHub: `pgh9mwv792-ai/budget-tracker` (branch `main`)
- Supabase project ref: `flnppvzyevcuawqxiksu`

## Deploy pipeline (a single `git push` to `main` now ships everything)
1. **Frontend:** `git push` → Vercel auto-rebuilds (~1–2 min).
2. **Edge Functions + DB migrations:** the same push triggers GitHub Actions
   (`.github/workflows/deploy-functions.yml`) whenever it touched
   `supabase/functions/**` or `supabase/migrations/**`. The workflow runs
   `supabase db push` (applies any new numbered migration) then
   `supabase functions deploy` (redeploys all functions). Watch it under the
   repo's **Actions** tab; a green check means it shipped.

Manual fallbacks (still valid if CI is down or you want to run one thing):
- Edge Functions: `npx supabase functions deploy <name>` (per function).
- DB migrations: paste the numbered `0001…` SQL file into the Supabase SQL
  Editor and Run. Files are idempotent, so re-running is safe.

CI requires three GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF` (`flnppvzyevcuawqxiksu`), and `SUPABASE_DB_PASSWORD`
(the database password — `supabase db push` needs it).

When a change needs more than a git push (e.g. a new edge-function *secret*),
**tell the user exactly which extra step to do**, or it will look "broken."

## Secrets (edge functions only — never in `VITE_` vars or frontend)
| Secret | Purpose |
| --- | --- |
| `PLAID_ENV`, `PLAID_CLIENT_ID`, `PLAID_SECRET` | Plaid API (production) |
| `ANTHROPIC_API_KEY` (opt. `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`) | Claude, via `chat` only |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 AES-GCM key encrypting `plaid_items.access_token_enc` at rest. Losing it makes stored bank tokens unrecoverable (re-link required). |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_...`) used by `stripe-create-checkout`, `stripe-portal`, `stripe-webhook`. |
| `STRIPE_PRICE_ID` | The recurring Price ID (`price_...`) for the Pro subscription. |
| `STRIPE_WEBHOOK_SECRET` | Signing secret (`whsec_...`) for the `stripe-webhook` endpoint; the function verifies every event against it. |
| `USDA_API_KEY` | USDA FoodData Central key used by the `food-search` edge function (meal-tracker food lookup). Free key at https://fdc.nal.usda.gov/api-key-signup. Real key = 1,000 req/hr; the `DEMO_KEY` fallback is only 30/hr. |
| `RESEND_API_KEY` | Resend API key (`re_...`) used by the `weekly-digest` edge function to send the Sunday email. |
| `DIGEST_CRON_SECRET` | Shared secret the cron/pg_net caller must send as the `x-digest-secret` header to run `weekly-digest` (which has JWT verification off). The function fails closed if this isn't set. |
| `DIGEST_FROM` (optional) | From address for the digest, e.g. `Budget Tracker <you@yourdomain.com>`. Defaults to `Budget Tracker <onboarding@resend.dev>` (Resend's test domain, which only delivers to the Resend account owner). |
| `APP_URL` (optional) | Base app URL used in the digest email's "Manage email preferences" footer link. Defaults to the live Vercel URL. |

The `weekly-digest` function also reuses `ANTHROPIC_API_KEY` (+ optional `ANTHROPIC_MODEL`) for its friendly rewrite. That rewrite is an **internal** call — it is *not* counted against the user's `ai_usage` daily cap, and any AI failure falls back to the deterministic text rather than skipping the email.

**weekly-digest deploy note:** like `stripe-webhook`, this function is called *without* a Supabase JWT (by pg_cron → pg_net), so it's set to `verify_jwt = false` in `supabase/config.toml` — the CI's bulk deploy applies it automatically. Security is the `DIGEST_CRON_SECRET` shared secret, not a JWT.

**Stripe webhook deploy note:** `stripe-webhook` is called by Stripe *without* a
Supabase JWT, so it must be deployed with JWT verification off. This is set once
in `supabase/config.toml` (`[functions.stripe-webhook] verify_jwt = false`), so
the CI's bulk `supabase functions deploy` applies it automatically — no manual
`--no-verify-jwt` and no workflow change. Security comes from the Stripe
signature check inside the function, not from a JWT.

**Frontend env vars** (Vercel + local `.env`, safe to expose — not secrets): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN` (error monitoring; when unset, Sentry is a no-op).

## Guardrails / conventions (don't break)
- **Secrets** (Plaid, Anthropic) live only in edge functions; never expose to the
  browser.
- **Plaid access tokens are encrypted at rest** (`access_token_enc`, AES-GCM via
  `encryptToken`/`decryptToken` in `_shared/plaid.ts`). Read tokens through
  `resolveAccessToken`; never persist a decrypted token.
- **`plaid_items` / `plaid_accounts`** use RLS-with-no-policies + `SECURITY
  DEFINER` RPCs (`get_plaid_connections`, `get_plaid_accounts`). Never add a broad
  select policy to these — `access_token` must never reach the frontend.
- **`supabase.functions.invoke` hides the function's error body on non-2xx** — dig
  the real message out of `error.context.json()`.
- **State pattern:** `App.jsx` loads all data in one `Promise.all` with each
  optional/Plaid fetch `.catch(() => [])` so an un-run migration degrades
  gracefully. Actions update the DB *and* local state together.
- **Transfers** (`kind === 'transfer'`) must stay excluded from income/expense
  math (internal savings↔checking moves).
- **Beginner-safe changes:** prefer additive, low-risk edits; verify with
  `npx vite build` before committing.

## Workflow
- Only commit/push when the user asks (or when it's the way to ship what they
  requested). Use clear commit messages.
- Real credit scores **can't** be auto-pulled (FCRA-regulated, not in Plaid's
  individual access) — the Credit tab is intentionally manual entry + computed
  card utilization. Don't "fix" this by claiming to fetch a live score.

## Deferred: micronutrient targets UI
Not to be built until explicitly requested. The `foods.nutrients` jsonb column
(migration 0014) already captures full micronutrient profiles — per-100g for
USDA imports and per-serving for supplement scans — so the data foundation is in
place. The future feature would add: RDA-based micronutrient targets (per user),
a % coverage calculation from summing `nutrients` across a day's food logs, and a
dashboard card showing which micros are short. Building it will require deciding
how to snapshot/aggregate `nutrients` at log time (food_logs currently snapshots
only the four macros) and reconciling per-100g vs per-serving units. Leave it
alone until asked.
