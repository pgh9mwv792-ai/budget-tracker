import { supabase } from './supabaseClient'
import { monthKey, todayISO } from './dateHelpers'
import { computeFoodCost } from './foodCost'
import { searchFoods, getFoodDetails } from './api'
import { merchantSimilarity, descriptorPurchaseDate, txnDescriptorText } from './receiptMatch'
import { normalizeFoodNutrients } from './nutrients'

const today = () => todayISO()
const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool-use format). These are the concrete actions
// the assistant is allowed to take inside the app. Each one maps to a handler
// in executeTool() below, which runs in the browser using the logged-in user's
// Supabase session — so everything respects the same row-level security as the
// rest of the app. We deliberately expose only additive / update actions (no
// deletes) so the assistant can't destroy data.
// ---------------------------------------------------------------------------
export const CHAT_TOOLS = [
  {
    name: 'add_transaction',
    description:
      'Record a new income or expense transaction. Amount is always a positive number; use kind to say whether money came in or went out. The result includes the new transaction id — if this expense paid for a meal you are also logging, pass that id to log_food as transaction_id so the charge and meal link (and the food-cost math is not double-counted).',
    input_schema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Positive dollar amount, e.g. 12.50' },
        kind: { type: 'string', enum: ['income', 'expense'] },
        date: { type: 'string', description: "Date as YYYY-MM-DD. Defaults to today if omitted." },
        category_name: {
          type: 'string',
          description: 'Name of an EXISTING category to file it under. Optional; leave out if unsure.',
        },
        note: { type: 'string', description: 'Optional description or merchant name.' },
      },
      required: ['amount', 'kind'],
    },
  },
  {
    name: 'add_category',
    description: 'Create a new spending or income category.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        kind: { type: 'string', enum: ['income', 'expense'] },
      },
      required: ['name', 'kind'],
    },
  },
  {
    name: 'set_budget',
    description: 'Set (or update) the monthly budget amount for an existing expense category.',
    input_schema: {
      type: 'object',
      properties: {
        category_name: { type: 'string', description: 'Name of an existing expense category.' },
        amount: { type: 'number', description: 'Monthly budget in dollars.' },
      },
      required: ['category_name', 'amount'],
    },
  },
  {
    name: 'add_goal',
    description: 'Create a savings goal.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        target_amount: { type: 'number' },
        current_amount: { type: 'number', description: 'Amount already saved. Defaults to 0.' },
      },
      required: ['name', 'target_amount'],
    },
  },
  {
    name: 'contribute_to_goal',
    description: 'Add money toward an existing savings goal (increases its current saved amount).',
    input_schema: {
      type: 'object',
      properties: {
        goal_name: { type: 'string', description: 'Name of an existing goal.' },
        amount: { type: 'number', description: 'Dollars to add to the saved amount.' },
      },
      required: ['goal_name', 'amount'],
    },
  },
  {
    name: 'add_food',
    description:
      'Add a food to the reusable food library with its per-serving macros. Use before logging a food that does not exist yet.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        serving_desc: { type: 'string', description: 'e.g. "1 cup", "6 oz". Optional.' },
        calories: { type: 'number' },
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fat: { type: 'number' },
        cost: { type: 'number', description: 'Optional cost per serving in dollars.' },
      },
      required: ['name', 'calories', 'protein', 'carbs', 'fat'],
    },
  },
  {
    name: 'log_food',
    description:
      'Log a food eaten on a day. Two ways to specify the amount:\n' +
      '• By weight (preferred for foods resolved via search_food_database): pass `grams` plus PER-100g macros (calories/protein/carbs/fat) taken verbatim from the database. The tool scales them to the eaten weight. Pass `fdc_id` (and `nutrients` if you have them) so the food is created in the library first as a reusable per-100g row — future logs reuse it and its cost.\n' +
      '• By servings: pass `servings` (no `grams`). If the food already exists in the library its macros are used automatically; otherwise provide per-serving macros directly.\n' +
      'NEVER invent macro numbers from your own knowledge — they must come from the library or search_food_database.',
    input_schema: {
      type: 'object',
      properties: {
        food_name: { type: 'string', description: 'Name of the food (existing library item, or a new one-off).' },
        meal: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description: 'Which meal to log under. Omit if unknown — the food is filed as Uncategorized.',
        },
        grams: {
          type: 'number',
          description:
            'Total grams eaten. When provided, calories/protein/carbs/fat are interpreted as PER 100 g and scaled to this weight.',
        },
        fdc_id: {
          type: 'string',
          description: 'USDA fdcId of the food (from search_food_database). Include when logging by grams so a per-100g library row is created/reused.',
        },
        nutrients: {
          description: 'Optional full per-100g nutrient array from search_food_database detail mode, stored on the created library food.',
        },
        servings: { type: 'number', description: 'Number of servings. Defaults to 1. Ignored when `grams` is given.' },
        transaction_id: {
          type: 'string',
          description: 'The id of a transaction from search_transactions that paid for this meal. Links the log to the bank charge; pass the transaction amount as `cost` alongside it.',
        },
        source: {
          type: 'string',
          enum: ['estimate'],
          description: "Pass 'estimate' when the macros are your best estimate of a named chain-restaurant item (published-nutrition knowledge, no database record). The created library food is flagged so the app marks its macros as approximate. Omit for library/USDA-resolved foods.",
        },
        date: { type: 'string', description: 'Date as YYYY-MM-DD. Defaults to today.' },
        calories: {
          type: 'number',
          description: 'Per-serving calories, OR per-100g calories when `grams` is given. Needed unless the food is an existing library item logged by servings.',
        },
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fat: { type: 'number' },
        cost: { type: 'number', description: 'Optional cost (per-serving, or per-100g when `grams` is given).' },
      },
      required: ['food_name'],
    },
  },
  {
    name: 'log_stack',
    description:
      "Log the user's whole daily supplement STACK in one step — every food they've flagged as part of their stack, each at one serving. Use this when they say things like \"log my stack\", \"I took my supplements\", or \"log my vitamins\". Show ONE confirmation listing the stack items and ask a single yes/no before calling this; never log them one at a time with log_food. If the stack is empty, tell them to flag foods as stack items on the Meals tab first.",
    input_schema: {
      type: 'object',
      properties: {
        meal: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
          description: 'Optional meal to file the stack under. Omit to file it as Uncategorized (the usual choice for supplements).',
        },
        date: { type: 'string', description: 'Date as YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'search_food_database',
    description:
      "Look up a food in the USDA food database to get real per-100g macros and portion conversions — use this to resolve foods the user describes in words before logging them. Without `fdcId`: text search returning the top ~5 matches (name, brand, per-100g calories/protein/carbs/fat, fdcId, and whether it's already in the user's library). With `fdcId`: the detail record for one food, including `portions` (household-measure → gram conversions like \"1 cup = 158 g\") and the full nutrient list. Prefer foods already in the user's library (they carry the user's costs). NEVER use macro numbers from your own knowledge — get them here.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for, e.g. "cooked white rice" or "ground beef 85 15".' },
        fdcId: { type: 'string', description: 'A specific food id from a prior search, to fetch its detail + portion conversions.' },
      },
    },
  },
  {
    name: 'search_transactions',
    description:
      "Search the user's own bank/manual transactions to find the charge behind a meal — use this when they say they bought food somewhere (\"the number 1 combo I got from In-N-Out yesterday\") so you can log it with its real price. Filters the transactions already loaded in the app; matches the merchant by name (bank descriptors abbreviate, e.g. \"IN N OUT #123 CA\" still matches \"In-N-Out\"). Returns the top matches with each one's date (the real authorized purchase date when the descriptor carries it), amount, note, category, and id. Resolve relative dates like \"yesterday\" yourself from today's date and pass them as YYYY-MM-DD. Pass the winning transaction's id (and amount) to log_food so the meal's cost and bank charge get linked.",
    input_schema: {
      type: 'object',
      properties: {
        merchant: { type: 'string', description: 'Merchant / store name to look for, e.g. "In-N-Out", "Chipotle".' },
        date_from: { type: 'string', description: 'Earliest date to include, YYYY-MM-DD. Optional.' },
        date_to: { type: 'string', description: 'Latest date to include, YYYY-MM-DD. Optional.' },
        amount_near: { type: 'number', description: 'Approximate dollar amount to prioritize, if the user mentioned roughly what they paid. Optional.' },
      },
    },
  },
  {
    name: 'set_nutrition_targets',
    description: 'Set the daily nutrition targets (calories and macros).',
    input_schema: {
      type: 'object',
      properties: {
        calories: { type: 'number' },
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fat: { type: 'number' },
      },
      required: ['calories', 'protein', 'carbs', 'fat'],
    },
  },
  {
    name: 'navigate_to',
    description: 'Switch the app to a different tab so the user can see the relevant screen.',
    input_schema: {
      type: 'object',
      properties: {
        tab: { type: 'string', enum: ['Dashboard', 'Transactions', 'Budgets', 'Meals', 'Goals', 'Categories'] },
      },
      required: ['tab'],
    },
  },
  {
    name: 'remember',
    description:
      "Save a small, durable fact or preference about the user so you recall it in future conversations (e.g. \"gets paid on the 1st\", \"is vegetarian\", \"wants to save for a car\"). Only store things that stay useful over time. NEVER store sensitive data like passwords, PINs, or full account/card numbers.",
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact to remember, phrased concisely.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'forget',
    description: 'Delete a previously remembered fact when the user asks you to forget it or it is no longer true.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Text matching the remembered fact to remove.' },
      },
      required: ['content'],
    },
  },
]

// ---------------------------------------------------------------------------
// Build a compact snapshot of the user's data to give the assistant awareness
// of the current state. Kept small on purpose (recent items + monthly rollups)
// so we don't blow up the token budget on long histories.
// ---------------------------------------------------------------------------
export function summarizeAppData({ categories = [], transactions = [], budgets = [], goals = [], nutritionTargets = null, foods = [], foodLogs = [], memories = [] }) {
  const thisMonth = monthKey(today())
  const money = (n) => `$${Number(n || 0).toFixed(2)}`

  const catById = new Map(categories.map((c) => [c.id, c]))

  // This month's income / expense totals.
  let inc = 0
  let exp = 0
  const spentByCat = new Map()
  for (const t of transactions) {
    if (monthKey(t.date) !== thisMonth) continue
    const amt = Number(t.amount) || 0
    if (t.kind === 'income') inc += amt
    else if (t.kind === 'expense') {
      exp += amt
      spentByCat.set(t.category_id, (spentByCat.get(t.category_id) || 0) + amt)
    }
    // transfers are internal moves — excluded from income and spending
  }

  const catLines = categories.map((c) => `- ${c.name} (${c.kind})`).join('\n') || '(none)'

  const budgetLines =
    budgets
      .map((b) => {
        const c = catById.get(b.category_id)
        if (!c) return null
        const spent = spentByCat.get(b.category_id) || 0
        return `- ${c.name}: ${money(spent)} spent of ${money(b.amount)} budget`
      })
      .filter(Boolean)
      .join('\n') || '(no budgets set)'

  const recent =
    transactions
      .slice(0, 12)
      .map((t) => {
        const c = t.category_id ? catById.get(t.category_id)?.name : null
        const sign = t.kind === 'income' ? '+' : t.kind === 'transfer' ? '⇄' : '-'
        return `- ${t.date} ${sign}${money(t.amount)} ${c ? `[${c}]` : t.kind === 'transfer' ? '[transfer]' : '[uncategorized]'}${t.note ? ` "${t.note}"` : ''}`
      })
      .join('\n') || '(none yet)'

  const goalLines =
    goals.map((g) => `- ${g.name}: ${money(g.current_amount)} saved of ${money(g.target_amount)}`).join('\n') ||
    '(no goals)'

  // Today's logged nutrition.
  const todaysLogs = foodLogs.filter((l) => l.date === today())
  const nut = todaysLogs.reduce(
    (a, l) => {
      const s = Number(l.servings) || 0
      a.calories += Number(l.calories) * s
      a.protein += Number(l.protein) * s
      a.carbs += Number(l.carbs) * s
      a.fat += Number(l.fat) * s
      return a
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )
  const targetLine = nutritionTargets
    ? `Targets: ${nutritionTargets.calories} kcal, ${nutritionTargets.protein}g protein, ${nutritionTargets.carbs}g carbs, ${nutritionTargets.fat}g fat`
    : 'Targets: not set'
  // Each item logged today, so the assistant always reflects the live list —
  // if the user removes one from the Meals tab it disappears here on the next turn.
  const todaysLogLines =
    todaysLogs
      .map((l) => {
        const s = Number(l.servings) || 0
        const meal = l.meal ? ` [${l.meal}]` : ''
        return `- ${l.name}${meal}: ${Math.round((Number(l.calories) || 0) * s)} kcal, ${round1(
          (Number(l.protein) || 0) * s
        )}g P`
      })
      .join('\n') || '(nothing logged today)'
  // Per-food detail (serving + per-serving macros + whether it has a USDA id)
  // so the assistant can convert a stated weight into the right number of
  // servings instead of blindly passing the user's number through.
  const foodLibraryLines =
    foods
      .slice(0, 40)
      .map((f) => {
        const serving = f.serving_desc ? `serving ${f.serving_desc}` : 'serving unknown'
        const usda = f.fdc_id ? ', USDA' : ''
        return `- ${f.name} (${serving}: ${Math.round(Number(f.calories) || 0)} kcal, ${round1(f.protein)}g P per serving${usda})`
      })
      .join('\n') || '(empty)'

  const stackFoods = foods.filter((f) => f.is_stack)
  const stackLine = stackFoods.length
    ? `Daily supplement stack (${stackFoods.length}): ${stackFoods.map((f) => f.name).join(', ')}. Use log_stack to log them all at once.`
    : 'Daily supplement stack: none flagged yet.'

  const memoryLines = memories.map((m) => `- ${m.content}`).join('\n') || '(nothing remembered yet)'

  // Food-cost intelligence: the money+food angle the app now leads with, so the
  // assistant can answer "what's my cheapest protein", "how much am I spending
  // on food", "am I eating out too much" from the same numbers the dashboard shows.
  const fc = computeFoodCost({ transactions, foodLogs, foods, nutritionTargets })
  const foodCostLines = (() => {
    if (!fc.hasData) return '(not enough food data yet — no meals with cost or tagged food spending)'
    const lines = []
    if (fc.spend.hasData) {
      lines.push(
        `- Food spend: ${money(fc.spend.perDay)}/day over the last ${fc.spend.days} days (${money(
          fc.spend.grocery
        )} groceries, ${money(fc.spend.restaurant)} eating out).`
      )
    }
    if (fc.protein.hasData) {
      const cov =
        fc.protein.coverage != null && fc.protein.coverage < 0.999
          ? ` (based on ${Math.round(fc.protein.coverage * 100)}% of logged meals having a cost)`
          : ''
      lines.push(`- Cost per 100g of logged protein: ${money(fc.protein.costPer100g)}${cov}.`)
    }
    if (fc.burn.average != null) {
      lines.push(
        `- This month's food spend: ${money(fc.burn.spentSoFar)} so far, projected ${money(
          fc.burn.projected
        )} vs a 3-month average of ${money(fc.burn.average)}.`
      )
    }
    if (fc.efficiency.hasData) {
      const top = fc.efficiency.ranked
        .slice(0, 5)
        .map((f) => `${f.name} (${money(f.costPer30g)}/30g protein)`)
        .join(', ')
      lines.push(`- Cheapest protein in the library, cheapest first: ${top}.`)
    }
    if (fc.bulk) {
      lines.push(
        `- Hitting the ${Math.round(fc.bulk.proteinTarget)}g daily protein target for a month runs about ${money(
          fc.bulk.monthlyCost
        )}.`
      )
    }
    return lines.join('\n')
  })()

  return `Today's date: ${today()}

WHAT YOU REMEMBER ABOUT THIS USER:
${memoryLines}

THIS MONTH: income ${money(inc)}, expenses ${money(exp)}, net ${money(inc - exp)}.

CATEGORIES:
${catLines}

BUDGETS (this month):
${budgetLines}

SAVINGS GOALS:
${goalLines}

RECENT TRANSACTIONS (up to 12 most recent):
${recent}

MEAL TRACKER — today logged: ${Math.round(nut.calories)} kcal, ${Math.round(nut.protein)}g protein, ${Math.round(nut.carbs)}g carbs, ${Math.round(nut.fat)}g fat. ${targetLine}.
Today's logged items (this is the live list — reflects removals):
${todaysLogLines}
Food library:
${foodLibraryLines}
${stackLine}

FOOD & MONEY (computed — use these for cost-per-protein and food-spending questions):
${foodCostLines}`
}

export function buildSystemPrompt(dataSummary) {
  return `You are the built-in assistant for "Budget Tracker", a personal finance and nutrition app the user built for themselves. You help the user understand their money and food data and take actions on their behalf.

The app has these tabs: Dashboard (charts + recurring bills), Transactions (income/expenses, bank import via Plaid, CSV export), Budgets (monthly per-category budgets), Meals (food/macro tracker that ties food cost back to spending), Goals (savings goals), Categories.

You can take actions using the provided tools (adding transactions, categories, budgets, goals, foods, food logs, nutrition targets, and switching tabs). Guidelines:
- Be concise and friendly. The user is a beginner, so avoid jargon.
- When the user asks you to record or change something, just use the appropriate tool, then briefly confirm what you did in plain language.
- Only reference categories/goals/foods that actually exist (see the data below). If the user names something that doesn't exist, either create it (for categories/foods) or ask which existing one they meant.
- Amounts are always positive numbers; "kind" (income/expense) carries the direction.
- If a request is ambiguous or would create obvious duplicates, ask a short clarifying question before acting.
- You cannot delete financial or food data — if the user wants something deleted, tell them to use the relevant tab's Delete/Remove button.
- Memory: when the user shares a durable fact or preference that would help you help them later (payday timing, dietary preferences, saving priorities, budgeting style), use the remember tool. Keep memories short. NEVER store sensitive information such as passwords, PINs, or full account/card numbers. Use forget when a remembered fact is no longer true or the user asks you to. What you already remember is listed in the data below.
- For analysis questions, use the data snapshot below. It only includes recent transactions and monthly rollups, so if the user asks about something outside that window, say you can see recent activity but they may want to check the full list on the Transactions tab.

WHEN THE USER ATTACHES A PHOTO (you can see attached images directly):
If it's a purchase receipt, handle it end-to-end so they don't have to type anything in:
1) Read the merchant, the FINAL total (after tax), and the purchase date from the image.
2) Record the expense right away with add_transaction: amount = the total, kind "expense", date = the receipt date, note = the merchant, and category_name = the best-fitting EXISTING expense category (omit if none fit). Briefly confirm the charge you added.
3) If the receipt is a FOOD purchase from a restaurant, fast-food place, or cafe, ALSO log what they ate, following "LOGGING A MEAL YOU BOUGHT OUT" below — except you ALREADY know the price and date from the receipt, so you do NOT need search_transactions. Resolve the item's macros the same way (web_search for the chain's official published numbers, else estimate a named chain item and pass source:"estimate"). Ask which meal if they didn't say, then log_food with cost = the receipt total and transaction_id = the id add_transaction just returned, so the meal links to the charge and the cost isn't counted twice. If the receipt lists several items, log the main meal item(s); never invent macros for lines you can't identify.
4) For a NON-food receipt, just add the transaction — no food logging.
If the image clearly isn't a receipt, just help with whatever the user is asking about it.

LOGGING FOOD BY DESCRIPTION (e.g. "log 2 cups white rice and 8oz ground beef for lunch"):
- FIRST decide which kind of item the user named, because they log differently:
  • A WHOLE prepared or restaurant/fast-food/branded item ordered as one unit — e.g. "a number 1 combo from In-N-Out", "a Big Mac", "a Chipotle burrito", "a slice of pizza". Its natural unit is the item itself, NOT a weight, so keep this simple and fast: do NOT search the USDA food database (it won't have a fast-food combo and only returns misleading component parts), do NOT ask for grams or ounces, and do NOT interrogate the user about portions. Get the macros this way:
    (1) PREFER web search: use the web_search tool to look up the item's OFFICIAL published calories/protein/carbs/fat — ideally from the restaurant's or brand's own nutrition page, otherwise a reliable nutrition source. Then briefly cite where the numbers came from in your confirmation (e.g. "per In-N-Out's official nutrition info"). This is the most accurate path, so use it for any named restaurant/fast-food/branded item.
    (2) FALLBACK, only if web search is unavailable or turns up nothing usable: estimate by DECOMPOSING the item into its standard named components — e.g. an In-N-Out #1 = Double-Double + fries + a medium drink — recall each component's published macros separately, add them up, and show the per-component breakdown in your confirmation. Decomposing into named parts lands closer than one lump guess. Say plainly that these are estimates.
    Either way, log the item as ONE whole unit with log_food (servings = how many the user said, default 1) — do NOT split it into separate ingredient logs and do NOT convert it to grams. Keep the confirmation to a short breakdown plus the totals; don't interrogate the user. This is the one case where estimating macros from your own knowledge is expected. When you estimate a chain item's macros this way, pass source:"estimate" to log_food so the app flags the numbers as approximate. If the user BOUGHT this meal out (rather than made it), also follow "LOGGING A MEAL YOU BOUGHT OUT" below to attach its real price from their transactions.
  • A raw INGREDIENT or portion given by an amount — e.g. "8oz ground beef", "2 cups white rice", "200g chicken". Use the amount rules below.
- For an INGREDIENT by amount: the number the user says is an AMOUNT, not a servings count. NEVER pass a weight like "8oz" or "200g" straight into log_food's servings field — that would multiply the serving by 8. Always resolve the amount to grams (or to the correct number of servings) first.
- If the user gives NO amount for an INGREDIENT ("log some chicken", "log rice"), ask how much (grams/oz, or a household measure) before logging. Don't assume 1 serving or any default. (A whole item like "a combo" already has its amount — one — so don't ask.)
- Resolve each INGREDIENT's macros in this order: (1) an existing library food (see the food library below — it carries the user's own costs), else (2) search_food_database. For raw ingredients, NEVER take macro numbers from your own knowledge — they come only from the library or the database. (The whole-restaurant-item exception above is the only time estimating is allowed.)
- If a described food has no exact match (a specific brand, "grass fed", etc. that USDA doesn't carry), pick the closest generic match and say so plainly in the confirmation, e.g. "closest match: ground beef 85/15 — USDA doesn't distinguish grass-fed".
- Convert the stated amount to grams using this hierarchy:
  (a) Exact weight units (g, oz, lb) are always fine — 1 oz = 28.35 g, 1 lb = 453.6 g.
  (b) Household measures (cups, tbsp, "1 medium", "1 slice") ONLY via that food's portion conversions from search_food_database detail mode (call it with the fdcId). Never guess a cup-to-gram number.
  (c) If the unit can't be resolved by (a) or (b) — e.g. "1 bowl", "a handful", "some" — ASK the user for the weight in grams or ounces instead of estimating. Do not log a guessed conversion.
- Logging a MATCHED LIBRARY food (from the food library below):
  • If it has a USDA id, prefer grams mode: convert the amount to grams and log with grams + the food's per-100g macros from search_food_database (reuses the same library row and its cost).
  • If it has NO USDA id but its serving is a plain weight (e.g. serving "8 oz" or "100 g"): convert both the stated amount and the serving to grams and log servings = stated_grams ÷ serving_grams (so "8oz" of a food whose serving is "8 oz" = 1 serving, and "16oz" = 2 servings). Do NOT log the raw stated number as servings.
  • If it has no USDA id and its serving is a household unit (e.g. "1 cup") and the user used that same unit, servings = the user's count. If the units differ or you can't line them up, ask for grams/oz.
- Resolve ALL items first, then show ONE confirmation for the whole batch: a compact line per item (food name as matched, computed grams, kcal + protein), and ask a single yes/no to log them. Don't confirm foods one at a time.
- Every log_food call MUST include a meal. Respect a named meal ("log to lunch" → meal "lunch"). If the user did NOT say which meal, ask this exact question before logging: "Which meal should I log this to - breakfast, lunch, dinner, or snack?" and wait for their answer. Never call log_food with an empty or missing meal.
- On approval (and once the meal is known), log each item with log_food. For USDA/database foods use grams mode (pass grams + the per-100g macros and fdc_id, so the library row gets created/reused); for a plain-weight library food with no USDA id, log the computed servings count.
- After logging, reply with the day's updated totals vs targets using the meal-tracker numbers in the data snapshot.
- Keep within the tool-call budget: one search per unresolved item (plus a detail call only when you need portion conversions). For long lists, issue the searches together rather than one round-trip each.

LOGGING A MEAL YOU BOUGHT OUT (restaurant / fast-food / cafe) — cross-reference the charge:
When the user says they BOUGHT a meal somewhere ("log the number 1 combo I got from In-N-Out yesterday"), tie it to the real bank charge and its price so the food-cost math is exact.
1) FIND THE CHARGE: call search_transactions with the merchant and a tight date window — resolve "yesterday"/"last night"/etc. to YYYY-MM-DD yourself from today's date and allow about ±1 day. If the user hinted at a price, pass amount_near.
2) RESOLVE THE ITEM'S MACROS in this order:
   (a) The user's food library FIRST — if they've logged this exact item before (e.g. a "Number 1 combo"), reuse that library food and its stored macros. Nothing to estimate.
   (b) Otherwise try search_food_database for the item (works for a single branded/packaged item; a multi-part combo won't be there — skip to (c)).
   (c) For a NAMED CHAIN-restaurant item only (In-N-Out, Chipotle, McDonald's…) you MAY estimate the macros from published nutrition info, but you MUST call them estimates in your confirmation and pass source:"estimate" to log_food (the app then shows an "est." marker wherever those macros appear).
   (d) If it's an unknown independent restaurant or the item is ambiguous, DON'T guess — ask the user for the approximate contents/macros first.
3) ONE CONFIRMATION: show a single summary — the matched transaction (its date + amount), the item, its macros (marked as estimates when applicable), and the target meal — then ask one yes/no. NEVER log before this confirmation.
4) ON APPROVAL: log with log_food as ONE whole unit (servings = how many), passing cost = the matched transaction's amount and transaction_id = its id, so the meal's price links to the charge and isn't counted twice. A new item becomes a reusable library food; a repeat order later reuses it.
Edge cases:
 • No matching transaction → still offer to log the food; ask for the approximate price (log with that cost, no transaction_id) or log it without a cost.
 • Several plausible charges → list them briefly and ask which one, then log against that id.
 • The meal rule still applies: if the user didn't say which meal, ask before logging.

Here is the user's current data:

${dataSummary}`
}

// ---------------------------------------------------------------------------
// Execute one tool call in the browser. `ctx` provides the current categories/
// goals plus an `actions` object (thin wrappers that call the API AND update
// React state) and `setActiveTab`. Returns a human-readable result string that
// gets sent back to the model as the tool_result.
// ---------------------------------------------------------------------------
export async function executeTool(name, input, ctx) {
  const { categories, goals, foods, transactions = [], memories = [], actions, setActiveTab } = ctx
  const findCat = (n) =>
    categories.find((c) => c.name.toLowerCase() === String(n || '').trim().toLowerCase())
  const isIsoDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)

  try {
    switch (name) {
      case 'add_transaction': {
        let categoryId = null
        let catNote = ''
        if (input.category_name) {
          const c = findCat(input.category_name)
          if (c) categoryId = c.id
          else catNote = ` (no category named "${input.category_name}", left uncategorized)`
        }
        const created = await actions.addTransaction({
          date: input.date || today(),
          amount: input.amount,
          kind: input.kind,
          categoryId,
          note: input.note || null,
        })
        return `Added ${input.kind} of $${Number(input.amount).toFixed(2)} on ${created.date}${catNote}. (transaction id ${created.id})`
      }
      case 'add_category': {
        if (findCat(input.name)) return `A category named "${input.name}" already exists.`
        await actions.addCategory({ name: input.name.trim(), kind: input.kind })
        return `Created ${input.kind} category "${input.name}".`
      }
      case 'set_budget': {
        const c = findCat(input.category_name)
        if (!c) return `No category named "${input.category_name}" exists. Create it first with add_category.`
        if (c.kind !== 'expense') return `"${c.name}" is an income category; budgets are only for expense categories.`
        await actions.setBudget(c.id, input.amount)
        return `Set the monthly budget for "${c.name}" to $${Number(input.amount).toFixed(2)}.`
      }
      case 'add_goal': {
        await actions.addGoal({
          name: input.name,
          targetAmount: input.target_amount,
          currentAmount: input.current_amount || 0,
        })
        return `Created goal "${input.name}" targeting $${Number(input.target_amount).toFixed(2)}.`
      }
      case 'contribute_to_goal': {
        const g = goals.find((x) => x.name.toLowerCase() === String(input.goal_name || '').trim().toLowerCase())
        if (!g) return `No goal named "${input.goal_name}" exists.`
        const newAmount = Number(g.current_amount || 0) + Number(input.amount)
        await actions.updateGoal(g.id, { current_amount: newAmount })
        return `Added $${Number(input.amount).toFixed(2)} to "${g.name}". Now $${newAmount.toFixed(2)} of $${Number(g.target_amount).toFixed(2)}.`
      }
      case 'add_food': {
        await actions.addFood({
          name: input.name,
          servingDesc: input.serving_desc || '',
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          cost: input.cost == null ? '' : input.cost,
        })
        return `Added "${input.name}" to the food library.`
      }
      case 'search_food_database': {
        if (input.fdcId != null && String(input.fdcId).trim()) {
          const detail = await getFoodDetails(String(input.fdcId).trim())
          if (!detail) return `No detail record for fdcId ${input.fdcId} — log it by weight (grams/oz) instead.`
          const lib = foods.find((f) => f.fdc_id && String(f.fdc_id) === String(detail.fdcId))
          const portionLines = (detail.portions ?? []).length
            ? (detail.portions ?? []).map((p) => `${p.label} = ${round1(p.grams)} g`).join('; ')
            : '(no household portions — use grams or oz)'
          return (
            `Detail for fdcId ${detail.fdcId} — ${detail.name}${detail.brand ? ` (${detail.brand})` : ''}. ` +
            `Per 100 g: ${round1(detail.calories)} kcal, ${round1(detail.protein)}g protein, ${round1(detail.carbs)}g carbs, ${round1(detail.fat)}g fat. ` +
            `Portions: ${portionLines}. ` +
            (lib ? `In library (food_id ${lib.id}${lib.cost != null ? `, cost $${Number(lib.cost).toFixed(2)}` : ''}).` : 'Not in library yet.')
          )
        }
        const q = String(input.query || '').trim()
        if (q.length < 2) return 'Give me at least two characters to search the food database.'
        const results = await searchFoods(q)
        if (!results.length) return `No matches in the food database for "${q}".`
        const lines = results.slice(0, 5).map((r, i) => {
          const lib = foods.find((f) => f.fdc_id && String(f.fdc_id) === String(r.fdcId))
          return (
            `${i + 1}. ${r.name}${r.brand ? ` (${r.brand})` : ''} [fdcId ${r.fdcId}] — per 100 g: ` +
            `${round1(r.calories)} kcal, ${round1(r.protein)}g protein, ${round1(r.carbs)}g carbs, ${round1(r.fat)}g fat` +
            (lib ? ` — already in library (food_id ${lib.id})` : '')
          )
        })
        return `Top matches for "${q}":\n${lines.join('\n')}`
      }
      case 'log_food': {
        const existing = foods.find(
          (f) => f.name.toLowerCase() === String(input.food_name || '').trim().toLowerCase()
        )

        // Gram / per-100g path (foods resolved via search_food_database). The
        // supplied macros are per 100 g; we scale them to the eaten weight. USDA
        // foods are created in the library first as a canonical per-100g row so
        // later logs reuse the same row (and its cost), matching the meal
        // tracker's "create then log" pattern.
        if (input.grams != null) {
          const grams = Number(input.grams)
          if (!(grams > 0)) return `I need a positive gram amount to log "${input.food_name}".`
          if (input.calories == null) {
            return `To log "${input.food_name}" by weight I need its per-100g macros from search_food_database first.`
          }
          const per100 = {
            calories: Number(input.calories) || 0,
            protein: Number(input.protein) || 0,
            carbs: Number(input.carbs) || 0,
            fat: Number(input.fat) || 0,
          }
          // Reuse a library row matched by fdcId (carries the user's cost); else,
          // for a USDA food create a per-100g row first.
          let food = input.fdc_id
            ? foods.find((f) => f.fdc_id && String(f.fdc_id) === String(input.fdc_id))
            : existing
          if (!food && input.fdc_id) {
            // The row is stored on a 100 g serving basis, so the normalized
            // per-serving micros equal the per-100g values (scale 1); day totals
            // then scale by log.servings (grams/100). Keep raw rows alongside.
            const rawNutrients = Array.isArray(input.nutrients) ? input.nutrients : []
            const normalized = normalizeFoodNutrients(rawNutrients, { source: 'usda', servingScale: 1 })
            food = await actions.addFood({
              name: input.food_name,
              servingDesc: '100 g',
              calories: Math.round(per100.calories),
              protein: round1(per100.protein),
              carbs: round1(per100.carbs),
              fat: round1(per100.fat),
              cost: input.cost == null ? '' : input.cost,
              fdcId: String(input.fdc_id),
              nutrients: rawNutrients.length ? [...rawNutrients, ...normalized] : null,
              source: 'usda',
            })
          }
          const servings = Math.round((grams / 100) * 100) / 100
          // Only trust a reused food's cost when it's stored per-100g; a row on a
          // different serving basis would scale wrong, so fall back to null.
          const per100Cost =
            food && /^100\s*g$/i.test(food.serving_desc || '')
              ? food.cost
              : input.cost == null
                ? null
                : Number(input.cost)
          await actions.logFood({
            date: input.date || today(),
            meal: input.meal ?? null,
            foodId: food?.id || null,
            name: food?.name || input.food_name,
            servings,
            calories: per100.calories,
            protein: per100.protein,
            carbs: per100.carbs,
            fat: per100.fat,
            cost: per100Cost == null ? null : per100Cost,
            transactionId: input.transaction_id || null,
          })
          const factor = grams / 100
          return `Logged ${round1(grams)} g of "${food?.name || input.food_name}" to ${input.meal || 'Uncategorized'} (${Math.round(per100.calories * factor)} kcal, ${round1(per100.protein * factor)}g protein).`
        }

        const macros = existing
          ? {
              calories: existing.calories,
              protein: existing.protein,
              carbs: existing.carbs,
              fat: existing.fat,
              // Log-level cost wins over the library default: a repeat restaurant
              // order that passes the new charge amount records that, not the
              // stale stored cost. Falls back to the library default otherwise.
              cost: input.cost != null ? input.cost : existing.cost,
            }
          : {
              calories: input.calories,
              protein: input.protein,
              carbs: input.carbs,
              fat: input.fat,
              cost: input.cost == null ? null : input.cost,
            }
        if (!existing && macros.calories == null) {
          return `"${input.food_name}" isn't in the library. Provide calories/protein/carbs/fat so I can log it, or add it first.`
        }
        // For a matched restaurant purchase (transaction_id) or an estimated
        // chain item (source), create a reusable library food so the same order
        // next time reuses it. Estimated items are flagged source='estimate' so
        // the app marks their macros as approximate. Plain one-off logs stay
        // detached (no library row), unchanged.
        let libFood = existing
        if (!libFood && (input.source || input.transaction_id)) {
          libFood = await actions.addFood({
            name: input.food_name,
            servingDesc: '1 serving',
            calories: macros.calories,
            protein: macros.protein,
            carbs: macros.carbs,
            fat: macros.fat,
            cost: macros.cost == null ? '' : macros.cost,
            ...(input.source === 'estimate' ? { source: 'estimate' } : {}),
          })
        }
        await actions.logFood({
          date: input.date || today(),
          // No meal → filed as Uncategorized (null).
          meal: input.meal ?? null,
          foodId: libFood?.id || null,
          name: libFood?.name || input.food_name,
          servings: input.servings || 1,
          calories: macros.calories || 0,
          protein: macros.protein || 0,
          carbs: macros.carbs || 0,
          fat: macros.fat || 0,
          cost: macros.cost == null ? null : macros.cost,
          transactionId: input.transaction_id || null,
        })
        const estNote = libFood?.source === 'estimate' || input.source === 'estimate' ? ' (macros are estimates)' : ''
        return `Logged ${input.servings || 1} serving(s) of "${input.food_name}" to ${input.meal || 'Uncategorized'}${estNote}.`
      }
      case 'log_stack': {
        const stack = foods.filter((f) => f.is_stack)
        if (stack.length === 0) {
          return 'Your daily stack is empty. Flag the supplements you take daily as stack items on the Meals tab (the ☆ Stack toggle in the food library), then try again.'
        }
        const date = input.date || today()
        for (const f of stack) {
          await actions.logFood({
            date,
            meal: input.meal ?? null,
            foodId: f.id,
            name: f.name,
            servings: 1,
            calories: Number(f.calories) || 0,
            protein: Number(f.protein) || 0,
            carbs: Number(f.carbs) || 0,
            fat: Number(f.fat) || 0,
            cost: f.cost == null ? null : Number(f.cost),
          })
        }
        return `Logged your daily stack (${stack.length} item${stack.length === 1 ? '' : 's'}) to ${input.meal || 'Uncategorized'} on ${date}: ${stack.map((f) => f.name).join(', ')}.`
      }
      case 'search_transactions': {
        const merchant = String(input.merchant || '').trim()
        const from = isIsoDate(input.date_from) ? input.date_from : null
        const to = isIsoDate(input.date_to) ? input.date_to : null
        const near = input.amount_near == null ? null : Number(input.amount_near)

        const scored = []
        for (const t of transactions) {
          // Transfers are internal moves, never a purchase behind a meal.
          if (t.kind === 'transfer') continue
          const descriptor = txnDescriptorText(t) || t.note || ''
          // The real purchase date: the descriptor's AUTHORIZED date when it
          // carries one (reused from receiptMatch), else the posted date.
          const authIso = descriptorPurchaseDate(descriptor, t.date)
          const effDate = authIso || t.date
          if (from && effDate < from) continue
          if (to && effDate > to) continue
          // Merchant match reuses the normalized-token similarity. When no
          // merchant was given, don't filter on it (date/amount-only search).
          const sim = merchant ? merchantSimilarity(merchant, descriptor) : 0
          if (merchant && sim < 0.3) continue
          const amt = Number(t.amount) || 0
          const amtGap = near == null ? 0 : Math.abs(amt - near)
          scored.push({ t, sim, amtGap, effDate, authorized: !!authIso })
        }

        // Best merchant match first, then closest amount, then most recent.
        scored.sort(
          (a, b) => b.sim - a.sim || a.amtGap - b.amtGap || (a.effDate < b.effDate ? 1 : -1)
        )
        const top = scored.slice(0, 5)
        if (!top.length) {
          const where = merchant ? ` matching "${merchant}"` : ''
          const when = from || to ? ' in that date range' : ''
          return `No transactions found${where}${when}. You can still log the food — just tell me roughly what it cost, or log it without a price.`
        }
        const lines = top.map(({ t, effDate, authorized }) => {
          const cat = t.category?.name ? ` [${t.category.name}]` : ''
          const note = t.note ? ` "${t.note}"` : ''
          return `- id ${t.id} · ${effDate}${authorized ? ' (authorized)' : ''} · $${Number(t.amount).toFixed(2)}${cat}${note}`
        })
        return `Top transaction matches (use the id + amount with log_food to link the charge):\n${lines.join('\n')}`
      }
      case 'set_nutrition_targets': {
        await actions.setTargets({
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
        })
        return `Set daily targets to ${input.calories} kcal, ${input.protein}g protein, ${input.carbs}g carbs, ${input.fat}g fat.`
      }
      case 'navigate_to': {
        setActiveTab(input.tab)
        return `Switched to the ${input.tab} tab.`
      }
      case 'remember': {
        await actions.addMemory(input.content.trim())
        return `Got it — I'll remember: "${input.content.trim()}".`
      }
      case 'forget': {
        const needle = String(input.content || '').trim().toLowerCase()
        const match = memories.find(
          (m) => m.content.toLowerCase().includes(needle) || needle.includes(m.content.toLowerCase())
        )
        if (!match) return `I don't have a saved memory matching "${input.content}".`
        await actions.deleteMemory(match.id)
        return `Forgotten: "${match.content}".`
      }
      default:
        return `Unknown tool: ${name}`
    }
  } catch (err) {
    return `Error running ${name}: ${err.message}`
  }
}

// Calls the chat Edge Function (which adds the API key and forwards to Claude).
export async function callChat({ system, messages, signal }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('chat', {
    body: { system, messages, tools: CHAT_TOOLS },
    headers: { Authorization: `Bearer ${session.access_token}` },
    // Lets the caller cancel an in-flight request (the chat "Stop" button).
    signal,
  })
  if (error) {
    // supabase.functions.invoke hides the function's response body on a non-2xx
    // status, so dig the real message (e.g. the rate-limit notice) out of
    // error.context, falling back to the generic message if we can't.
    let message = error.message
    try {
      const details = await error.context.json()
      if (details?.error) message = details.error
    } catch {
      // keep the fallback message
    }
    throw new Error(message)
  }
  return data
}
