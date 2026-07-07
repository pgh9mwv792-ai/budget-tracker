# Budget Tracker — Full App Handoff

## 1. What it is
A personal budgeting web app for a single self-taught beginner developer, intended for eventual public release. It combines manual + automatic (bank-linked) transaction tracking, budgets, savings goals, a meal/nutrition tracker, a credit-score & utilization tracker, and an AI assistant that can both answer questions and take actions in the app.

- **Live site:** `https://budget-tracker-rose-mu.vercel.app/`
- **GitHub:** `pgh9mwv792-ai/budget-tracker` (branch `main`, auto-deploys to Vercel on push)
- **Local path:** `/Users/cedarhale/Desktop/budget-tracker`
- **Supabase project ref:** `flnppvzyevcuawqxiksu`

## 2. Tech stack
- **Frontend:** React 19 + Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), Recharts for charts. Linter is `oxlint`. No TypeScript in app code (`.jsx`); Deno/TS only in edge functions.
- **Backend:** Supabase — Postgres (with Row-Level Security), Auth, Storage (avatars), and Deno Edge Functions.
- **Bank data:** Plaid (`react-plaid-link` on the frontend; REST via `fetch` on the backend). **Currently in Plaid *production*** (individual/free-trial access = up to 10 live bank connections). Products: `['transactions']`, country `['US']`.
- **AI:** Anthropic Claude API, called **only** from the `chat` edge function (the API key never touches the browser).
  - Assistant model: `claude-sonnet-4-5-20250929` (override via `ANTHROPIC_MODEL` secret), `max_tokens: 1024`.
  - Receipt scanning reuses the same `chat` function with an image block (Claude vision).

## 3. Deploy pipeline
Three independent deploy paths — a `git push` only ships the frontend:
1. **Frontend:** `git push` → Vercel auto-rebuilds (~1–2 min).
2. **Edge Functions:** `npx supabase functions deploy <name>` per function.
3. **DB migrations:** run manually — paste the SQL file's contents into the Supabase **SQL Editor** and Run. Migrations are hand-numbered `0001`…`0009` and written to be idempotent.

**Secrets on the Supabase project:** `PLAID_ENV` (=`production`), `PLAID_CLIENT_ID`, `PLAID_SECRET`, `ANTHROPIC_API_KEY` (and optional `ANTHROPIC_MODEL`, `AI_DAILY_LIMIT`).

## 4. Database schema (migrations `supabase/migrations/`)
Every user-owned table has RLS with an "owned by user" policy (`auth.uid() = user_id`). Tables:
- **`categories`** (0001) — name + `kind` ('income'|'expense'), unique per user. App seeds 10 defaults on first login.
- **`transactions`** (0001) — date, `amount numeric(12,2)`, `kind`, note, `source` ('manual'|'plaid'), `plaid_transaction_id` (unique), `category_id`. Later: `account_id` (0007) and `kind` extended to include `'transfer'` (0007).
- **`goals`** (0001) — name, target_amount, current_amount.
- **`plaid_items`** (0001) — one row per linked bank; holds `access_token`, `item_id`, `institution_name`, `cursor`. **RLS with NO user policies** → only the service-role key (inside edge functions) can read it, so `access_token` can never reach the browser. Frontend reads a safe subset via `get_plaid_connections()` (SECURITY DEFINER RPC).
- **`merchant_rules`** (0002) — remembers merchant→category so future/imported transactions auto-categorize. Keyed by `(user_id, merchant_key)`.
- **`budgets`** (0002) — per-category monthly amount, keyed `(user_id, category_id)`.
- **`foods`** / **`food_logs`** / **`nutrition_targets`** (0003) — meal tracker library, per-meal logs, and calorie/macro targets. Later additions:
  - **`foods.nutrients`** (0014) — a `jsonb` array capturing each food's full micronutrient profile. It holds two kinds of rows: **raw** rows exactly as read from the source (USDA per-100g detail, or a supplement label per-serving) and **normalized** rows (discriminated by an `id` field matching a canonical nutrient in `src/lib/nutrients.js`). **Storage decision: normalized rows are stored per *serving*, not per 100g** — USDA raw rows are scaled by `(grams/100)*qty` at food-creation time (`FoodSearchSheet.jsx`), supplement labels are already per-serving (scale 1). So a day's total for a nutrient is simply `Σ normalized.amount × log.servings` — no unit reconciliation at read time. `normalizeFoodNutrients` is idempotent (skips rows that already have an `id`), so re-running the backfill is safe (`scripts/backfill-nutrients.mjs`).
  - **`foods.is_stack`** (0021) — boolean, default false, partial-indexed. **Decision: the "daily stack" is modeled as a flag on the food itself, not a separate join table** — a stack is just "the foods I take every day," so a nullable-safe boolean keeps it additive and beginner-safe (every existing/future food starts false). Powers the one-tap **Log my stack** button and the assistant's `log_stack` tool.
  - **`nutrition_targets.micro_targets` + `sex`** (0020) — `micro_targets` is a `jsonb` map of `{ [nutrientId]: { target, upper_limit } }` holding only user *overrides*; unset nutrients fall back to the built-in RDA/UL table in `nutrients.js` keyed off the `sex` cohort (`'male'|'female'|'neutral'`, default `'neutral'`). `upsertNutritionTargets` writes each field only when defined, so saving micro targets never clobbers macros.
- **`assistant_memories`** (0004) — durable facts the AI is told to remember.
- **`ai_usage`** (0005) — `(user_id, day, count)`; enforces a **per-user daily assistant cap** (`increment_ai_usage` RPC, default **100/day**, resets midnight UTC).
- **`plaid_accounts`** (0007, + `credit_limit` in 0008) — per-account balances (checking/savings/credit/loan): current/available balance, credit limit, type/subtype, mask. Same service-role-only pattern; frontend reads via `get_plaid_accounts()` RPC.
- **`credit_scores`** (0009) — manual credit-score log: `score` (300–850), `source`, `recorded_on`, `note`. Normal user-owned RLS.
- **`receipts`** / **`receipt_items`** / **`receipt_item_rules`** (0016) — itemized receipt scanning. `receipts` links a scanned receipt to the transaction it itemizes via `matched_transaction_id` (nullable FK → `transactions`, unique so one receipt per charge); when a scan matches a Plaid row, that row stays the money record and **no duplicate transaction is created**. `receipt_items` holds each printed line **verbatim** (`raw_name`) with `price`/`quantity`/`unit`/`is_food` and an optional `food_id` (FK → `foods`). `receipt_item_rules` is the receipt-item analogue of `merchant_rules`: `(user_id, item_key)` → `food_id`, remembering "365 ORG CHKN BRST" → the user's food so re-scans auto-suggest. All three are normal user-owned RLS.

## 5. Edge Functions (`supabase/functions/`)
- **`chat`** — proxies to Claude with the assistant tools; enforces the daily usage cap; also serves receipt-image and supplement-label parsing (Claude vision).
- **`food-search`** — USDA FoodData Central lookup for the meal tracker. Detail mode passes each nutrient's USDA number through (`usda_number`) so `lib/nutrients.js` can map it to a canonical micronutrient at food-creation time.
- **`plaid-create-link-token`** — creates a Plaid Link token.
- **`plaid-exchange-public-token`** — swaps the public token for an access token, stores the `plaid_items` row, and immediately calls `syncAccounts` so balances show right away.
- **`plaid-sync-transactions`** — cursor-based `/transactions/sync`; accepts `{full:true}` to re-import full history & re-classify; classifies each txn via `classifyKind`; upserts on `plaid_transaction_id`; **preserves user-set categories** on re-sync; refreshes account balances.
- **`plaid-remove-item`** — disconnects a bank (`/item/remove`), deletes its `plaid_accounts` rows and the `plaid_items` row; keeps transaction history.
- **`delete-account`** — permanently deletes the user and all their data.
- **`_shared/plaid.ts`** — `plaidFetch` (REST wrapper), `syncAccounts` (upserts balances incl. `credit_limit`), and `classifyKind` → 'income'|'expense'|'transfer'. **Transfers** are detected from Plaid `personal_finance_category` (`TRANSFER_IN/OUT`) or legacy category text, so internal savings↔checking moves are excluded from all income/expense totals.

## 6. Frontend features (by tab / component)
Tabs (in `NavBar.jsx`): **Dashboard, Transactions, Budgets, Credit, Meals, Goals, Categories**, plus Settings.

- **Dashboard** (`Dashboard.jsx`) — Recharts-driven overview:
  - **VerdictCard** (month outlook: projected income/expense/net).
  - **Accounts panel** (checking/savings "cash on hand", credit cards with limit + utilization bar).
  - Spending-by-category pie, trailing-3-month income bar.
  - **QuickAsk** bar (hands a prompt to the assistant), **Insights strip**, **Weekly** summary, **Food & money** card, **Recurring & upcoming** detection.
  - Forecast/insight math lives in `src/lib/forecast.js`; recurring detection + rule matching in `src/lib/analysis.js`.
- **Transactions** (`TransactionList.jsx`, `TransactionForm.jsx`, `UncategorizedBucket.jsx`, `PlaidLinkButton.jsx`, `ReceiptScanner.jsx`):
  - Manual add/edit/delete; filter by kind incl. **Transfers**.
  - **PlaidLinkButton** — "Connect a bank or credit card" (Plaid Link), "Sync transactions", and "Re-import & fix" (full re-classify). Credit cards come in automatically with the linking institution.
  - **UncategorizedBucket** — assign categories; auto-cascades the same category to same-merchant transactions and saves a merchant rule (transfers excluded).
  - **ReceiptScanner** — upload a receipt photo → Claude vision parses it (image downscaled client-side). Two modes via a toggle: **Quick total** (one editable transaction, the original behavior) and **Itemize** (`ReceiptItemizer.jsx`): Claude transcribes every line verbatim (`parseReceiptItemized` in `lib/receipt.js`, which accepts **multiple photos** of one receipt — e.g. Whole Foods' separate items/totals slips — merged in a single Claude call), then a two-step verify-before-save flow — (1) **match** the receipt to an existing Plaid charge (pure **confidence-scored** ranking in `lib/receiptMatch.js`, unit-tested in `receiptMatch.test.js`: candidates must be `plaid`/`expense`/unclaimed; the amount must be exact or within `max($8, 10%)`; scoring combines amount + merchant + date. The transaction date comes from the descriptor's `AUTHORIZED ON MM/DD` when present (the true purchase date, year inferred across the Dec/Jan boundary), else the posted date with a 0..+4 day window. Merchant similarity ignores store numbers, state codes, and generic words (`PURCHASE`/`ON`/…). **High** = exact amount + merchant + date → pre-selected for one-tap confirm; **medium** = merchant + date with the amount within tolerance (coupon/tax), shown with an explanation line stating both amounts and requiring explicit confirm; a non-exact amount *requires* a merchant match and an exact amount at a clearly different merchant is excluded — nothing auto-links, and a below-threshold result returns empty rather than a bad best-guess. Confirming links the receipt to the Plaid row **without** creating a duplicate transaction — no-match falls back to a manual transaction), then (2) **map** each food line to a library/USDA food (a remembered `receipt_item_rules` mapping pre-fills; else USDA search / manual library pick / skip). Confirming a line saves the rule and flows the receipt price into the food's default `cost` (per-unit when a weight/qty is present). Groceries are **not** logged as eaten — mapping only connects money to the library. If the matched transaction is uncategorized, an inline prompt offers to categorize it via the normal cascade flow.
  - Transactions that carry a receipt show a **🧾 receipt** badge in `TransactionList`; tapping expands a read-only list of the line items and their linked foods.
- **Budgets** (`BudgetManager.jsx`) — set/remove per-category monthly budgets, progress vs. actual spend.
- **Credit** (`CreditTab.jsx`) — **manual credit-score log** (score + source + date + note) with a Recharts trend line and "since last / since start" deltas, plus a **utilization panel** computed from linked credit cards (overall % and per-card breakdown, highlighting the highest-impact card). *Note: real scores cannot be auto-pulled — that's FCRA-regulated bureau data not in Plaid's individual access; hence manual entry.*
- **Meals** (`MealTracker.jsx`) — food library, per-meal logging, calorie/macro targets, optional cost tracking. Also:
  - **Supplement scanner** (`SupplementScanner.jsx` + `lib/supplement.js`) — photograph/upload a Supplement Facts panel → Claude vision reads it → an editable review card of ingredients → saves a food (`source: 'supplement_scan'`) that logs like any other food. Ingredients are captured into `foods.nutrients` (raw + normalized). A "daily stack" opt-in on the review card sets `is_stack`.
  - **Micronutrients section** (`MicronutrientSection.jsx` + `lib/micronutrients.js`) — a collapsible panel below the macro targets showing ~23 curated vitamin/mineral rows in `CURATED_ORDER`, each with consumed/target and a progress bar (sky < 100% → emerald ≥ RDA → **amber past the tolerable upper limit**). Totals come from summing each logged food's normalized per-serving micros × servings. **Coverage honesty:** a nutrient whose reporting foods make up < 70% of the day's calories is prefixed with `~` (likely an undercount), since many library foods don't carry a full micro profile. "Edit targets" opens `MicroTargetsEditor` (pick sex cohort; per-nutrient target/UL overrides with defaults as placeholders; per-nutrient and global "reset to defaults").
  - **Log my stack** — one-tap button (shown when the user has any `is_stack` foods) that logs each stack food at one serving after a single confirmation.
  - The nutrition **sex cohort** is also editable in Settings → Nutrition profile (`Settings.jsx`), which just saves `{ sex }` to `nutrition_targets`.
- **Goals** (`GoalTracker.jsx`) — savings goals with contributions.
- **Categories** (`CategoryManager.jsx`) — CRUD + reset-to-defaults (cascades to budgets/rules/transactions).
- **Settings** (`Settings.jsx`) — Profile (display name + avatar in Supabase Storage), Email change, Password change, **Two-factor (TOTP MFA)**, **Connected banks** (list + disconnect), **Data export** (JSON backup via `lib/backup.js`; CSV via `lib/csv.js`), and **Delete account** (danger zone).
- **Onboarding** (`Onboarding.jsx`) — first-run flow for brand-new users; can load a month of sample data.

## 7. Auth (`contexts/AuthContext.jsx`, `Login.jsx`, `MfaChallenge.jsx`)
Email+password, **magic link** (OTP), and **sign-up**; password reset; **TOTP two-factor** challenge on login. `ThemeContext.jsx` provides light/dark mode (dark styles throughout).

## 8. The AI assistant (`ChatWidget.jsx` + `lib/chat.js`)
Floating 💬 widget. Runs an **agentic loop** (up to 8 steps) that can call these tools and reflect results back into app state live:
`add_transaction`, `add_category`, `set_budget`, `add_goal`, `contribute_to_goal`, `add_food`, `log_food`, `log_stack`, `set_nutrition_targets`, `navigate_to`, `remember`, `forget`. (`log_stack` logs every `is_stack` food at one serving in a single step — the model confirms once before calling it.)
- It's given a summarized snapshot of the user's data as context, and a 🧠 memory panel shows/deletes saved memories.
- **Stop** control (Send button becomes a stop square; also **`Esc`** while working) truly aborts the in-flight request via `functions.invoke({ signal })` and safely rewinds model history.
- **Edit-a-sent-message** (hover a user bubble → ✎ → edit → resend) rewinds the conversation to that point, à la Claude.

## 9. Key architectural conventions (don't break these)
- **Sensitive tables** (`plaid_items`, `plaid_accounts`) use RLS-with-no-policies + `SECURITY DEFINER` RPCs to expose only safe columns. Never add a broad select policy to these.
- **All AI/Plaid secrets** live in edge functions only; never expose them to the browser.
- **`supabase.functions.invoke` hides the function's error body on non-2xx** — dig the real message out of `error.context.json()` (see `PlaidLinkButton.jsx` and `lib/chat.js`).
- **State pattern:** `App.jsx` loads everything in one `Promise.all` (each Plaid/optional fetch `.catch(()=>[])` so a not-yet-run migration degrades gracefully instead of crashing), and passes data + action callbacks down. Actions update the DB *and* local state so assistant/tab changes appear instantly.
- **Transfers** must stay excluded from income/expense math (they're filtered by `kind`).

## 10. Known pending / setup items
- **Migration `0009_credit_scores.sql` may still need to be run** in the Supabase SQL Editor for the Credit tab's score log to persist (the utilization panel works without it). Confirm 0007/0008 were run too if account balances aren't showing.
- The `plaid-remove-item`, `plaid-sync-transactions`, and `plaid-exchange-public-token` functions must be deployed for account/transfer/disconnect features to work.
- Bundle is a single ~945 kB JS chunk (build warns >500 kB) — no code-splitting yet.
