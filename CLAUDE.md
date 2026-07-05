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

## Deploy pipeline (three separate paths — a git push ships ONLY the frontend)
1. **Frontend:** `git push` → Vercel auto-rebuilds (~1–2 min).
2. **Edge Functions:** `npx supabase functions deploy <name>` (per function).
3. **DB migrations:** run by hand — paste the SQL file into the Supabase SQL
   Editor and Run. Files are numbered `0001…` and written to be idempotent.

When a change needs more than a git push, **tell the user exactly which of these
extra steps to do**, or it will look "broken" to them.

## Secrets (edge functions only — never in `VITE_` vars or frontend)
| Secret | Purpose |
| --- | --- |
| `PLAID_ENV`, `PLAID_CLIENT_ID`, `PLAID_SECRET` | Plaid API (production) |
| `ANTHROPIC_API_KEY` (opt. `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`) | Claude, via `chat` only |
| `TOKEN_ENCRYPTION_KEY` | 32-byte base64 AES-GCM key encrypting `plaid_items.access_token_enc` at rest. Losing it makes stored bank tokens unrecoverable (re-link required). |

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
