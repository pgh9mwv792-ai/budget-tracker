import { supabase } from './supabaseClient'
import { monthKey } from './dateHelpers'

const today = () => new Date().toISOString().slice(0, 10)

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
      'Record a new income or expense transaction. Amount is always a positive number; use kind to say whether money came in or went out.',
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
      'Log a food eaten on a day. If the food already exists in the library, its macros are used automatically; otherwise provide the macros directly.',
    input_schema: {
      type: 'object',
      properties: {
        food_name: { type: 'string', description: 'Name of the food (existing library item, or a new one-off).' },
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        servings: { type: 'number', description: 'Number of servings. Defaults to 1.' },
        date: { type: 'string', description: 'Date as YYYY-MM-DD. Defaults to today.' },
        calories: { type: 'number', description: 'Per-serving calories. Only needed if the food is not in the library.' },
        protein: { type: 'number' },
        carbs: { type: 'number' },
        fat: { type: 'number' },
        cost: { type: 'number', description: 'Optional per-serving cost.' },
      },
      required: ['food_name', 'meal'],
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
    else {
      exp += amt
      spentByCat.set(t.category_id, (spentByCat.get(t.category_id) || 0) + amt)
    }
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
        return `- ${t.date} ${t.kind === 'income' ? '+' : '-'}${money(t.amount)} ${c ? `[${c}]` : '[uncategorized]'}${t.note ? ` "${t.note}"` : ''}`
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
  const foodNames = foods.map((f) => f.name).slice(0, 40).join(', ') || '(empty)'

  const memoryLines = memories.map((m) => `- ${m.content}`).join('\n') || '(nothing remembered yet)'

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
Food library: ${foodNames}`
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
  const { categories, goals, foods, memories = [], actions, setActiveTab } = ctx
  const findCat = (n) =>
    categories.find((c) => c.name.toLowerCase() === String(n || '').trim().toLowerCase())

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
        return `Added ${input.kind} of $${Number(input.amount).toFixed(2)} on ${created.date}${catNote}.`
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
      case 'log_food': {
        const existing = foods.find(
          (f) => f.name.toLowerCase() === String(input.food_name || '').trim().toLowerCase()
        )
        const macros = existing
          ? { calories: existing.calories, protein: existing.protein, carbs: existing.carbs, fat: existing.fat, cost: existing.cost }
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
        await actions.logFood({
          date: input.date || today(),
          meal: input.meal,
          foodId: existing?.id || null,
          name: existing?.name || input.food_name,
          servings: input.servings || 1,
          calories: macros.calories || 0,
          protein: macros.protein || 0,
          carbs: macros.carbs || 0,
          fat: macros.fat || 0,
          cost: macros.cost == null ? null : macros.cost,
        })
        return `Logged ${input.servings || 1} serving(s) of "${input.food_name}" to ${input.meal}.`
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
export async function callChat({ system, messages }) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const { data, error } = await supabase.functions.invoke('chat', {
    body: { system, messages, tools: CHAT_TOOLS },
    headers: { Authorization: `Bearer ${session.access_token}` },
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
