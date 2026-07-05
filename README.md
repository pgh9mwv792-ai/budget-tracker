# Budget Tracker

Personal budgeting app. React + Vite frontend, Supabase (Postgres + Auth) backend,
Tailwind for styling, Recharts for charts, Plaid for bank auto-import.

## Accounts / keys you need to create before this runs

1. **Supabase project** — https://supabase.com/dashboard → New project.
   - Project Settings → API: copy the **Project URL** and **anon public key**
     into your `.env` (see below).
2. **Plaid developer account** — https://dashboard.plaid.com/signup.
   - Team Settings → Keys: copy your **client_id** and the **sandbox secret**.
   - You'll set these as Supabase Edge Function secrets, not in `.env`
     (Plaid secrets must never reach the browser).

## One-time setup

```bash
npm install
cp .env.example .env
# edit .env: fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
```

### 1. Create the database tables

In the Supabase dashboard, open SQL Editor and run the contents of
`supabase/migrations/0001_init.sql`. This creates `categories`,
`transactions`, `goals`, `plaid_items`, plus Row Level Security policies so
each row is only visible to the user who owns it.

### 2. Enable email auth

Supabase → Authentication → Providers: Email should already be on by
default. Since this is a single-user app you can turn off "Confirm email"
under Authentication → Settings if you don't want to click a confirmation
link the first time you sign up.

### 3. Deploy the Plaid Edge Functions (needed for bank auto-import)

Install the Supabase CLI if you don't have it:

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR-PROJECT-REF
```

Set Plaid secrets on the project (these stay server-side, never in the
frontend bundle):

```bash
supabase secrets set PLAID_CLIENT_ID=your-plaid-client-id
supabase secrets set PLAID_SECRET=your-plaid-sandbox-secret
supabase secrets set PLAID_ENV=sandbox
```

Deploy the three functions:

```bash
supabase functions deploy plaid-create-link-token
supabase functions deploy plaid-exchange-public-token
supabase functions deploy plaid-sync-transactions
```

(`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
injected automatically into Edge Functions by Supabase — no need to set
those yourself.)

In Plaid sandbox, when Plaid Link opens, use username `user_good` and
password `pass_good` to simulate a connected bank.

### 4. Run it

```bash
npm run dev
```

Open the local URL, sign up with an email + password (or use the magic
link tab), and you're in. Log in with the same email from your phone's
browser and you'll see the same data, since everything lives in Supabase.

## Project structure

```
src/
  components/       UI components (Dashboard, TransactionList, GoalTracker, CategoryManager, PlaidLinkButton, ...)
  contexts/          AuthContext (Supabase session state)
  lib/
    supabaseClient.js  Supabase client init
    api.js             All Supabase queries (categories/transactions/goals/plaid)
    dateHelpers.js      Month-key / rolling-average helpers
supabase/
  migrations/0001_init.sql   Schema + RLS policies
  functions/                  Plaid Edge Functions (Deno)
```

## Notes

- Plaid access tokens are stored in `plaid_items.access_token`, a table
  with no RLS policies granted to regular users — only the Edge Functions
  (using the service-role key) can read/write it. The frontend fetches a
  safe list of connected institutions via the `get_plaid_connections()`
  Postgres function, which never returns the access token.
- Auto-imported Plaid transactions land with `category_id = null` and show
  up in the amber "Uncategorized" box at the top of the Transactions tab
  for quick assignment.
- Switch `PLAID_ENV` to `development` or `production` (and use real Plaid
  keys) when you're ready to connect a real bank account instead of the
  sandbox.
