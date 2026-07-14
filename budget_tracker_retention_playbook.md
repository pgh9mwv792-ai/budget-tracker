# Budget Tracker — Retention & Subscription Playbook

Retention for a consumer budgeting app comes down to a handful of things, and a couple of them are unglamorous mechanics that matter more than any feature.

## Priority order (do in this sequence)

1. Time-to-first-insight (onboarding)
2. Sync-health detection + one-tap repair flow
3. Stripe dunning / involuntary churn config (an afternoon, do it once)
4. Weekly ritual notification
5. Surface accumulated history (recaps, trends)
6. One-question cancellation survey

The first three plug leaks; the fourth builds the habit. None of these are new features in the roadmap sense — they sharpen the loop around what's already built, staying inside the no-new-features rule while protecting the revenue the marketing push generates.

---

## 1. Retention is decided in the first session, not month three

The strongest predictor of whether someone is still paying in six months is how fast they hit the "oh, this works" moment in session one.

For Budget Tracker that moment is: **bank connected → transactions pulled → something insightful on screen** ("you spent $340 on food delivery last month") within a few minutes of signup.

Every screen, permission ask, or empty state between signup and that moment is where most eventual churn actually happens.

**Action:** Walk your own onboarding with a stopwatch. Count taps to first insight. Cut everything that isn't load-bearing.

## 2. Build a recurring ritual, not just recurring value

Budgeting apps are one of the highest-churn consumer categories. People don't quit because the app failed — they quit because looking at their spending makes them feel bad, so they stop opening it, then wonder why they're paying.

Apps that retain (YNAB is the case study) sell a **ritual**: a weekly ~10-minute check-in with a clear start and finish, rather than an ambient dashboard.

**Action:** One well-designed weekly summary notification — "your week: $412 spent, $88 under budget" — leading with progress, never guilt. Tone is a retention feature: shame churns, progress retains.

## 3. Broken bank sync is the #1 churn driver

For any Plaid-based app, when a connection silently dies and transactions stop flowing, user trust dies with it. They open the app, the numbers are wrong, and the subscription becomes "the thing that doesn't even work."

**Actions:**
- Detect stale/dead Plaid connections automatically
- Tell the user proactively: "Chase needs reconnecting — takes 30 seconds"
- Make repair one tap from the notification/banner
- Treat sync-health monitoring as a core feature — highest-leverage engineering for retention as a solo dev

## 4. Involuntary churn: fix it in Stripe settings

A large share of subscription "churn" (often 20–40% of cancellations) is just expired or declined cards, not decisions.

**Actions (Stripe dashboard, one afternoon):**
- Enable Smart Retries
- Enable automatic card updater
- Enable dunning emails (pre-expiry warning + failed-payment sequence)

Recovers real revenue forever. Almost every first-time founder skips it.

## 5. Accumulated history is the moat — make it visible

The longer someone uses the app, the more their data is worth: trends, year-over-year comparisons, "grocery spending vs. last winter." History is why canceling starts to feel like losing something — but only if the app surfaces it.

**Actions:**
- Monthly trend views
- Anniversary / year-in-review recaps
- Lean on the differentiator: nutrition × spending. "Cost per gram of protein this month" is data that exists nowhere else — data people won't walk away from.

## 6. Ask why people cancel — one question

A single "what made you cancel?" with ~4 options teaches more than any analytics dashboard. At current scale you can read every answer and often fix the actual thing.

Suggested options: too expensive / bank sync problems / didn't use it enough / missing something I needed (with a free-text line).
