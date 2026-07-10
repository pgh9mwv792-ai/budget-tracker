import { addDays, todayISO } from './dateHelpers'

// Builds a full, in-memory sample month for the signed-out "Explore with sample
// data" demo. Everything here mimics the exact DB row shapes the real components
// read (see src/lib/api.js), so Dashboard / Subscriptions / MealTracker render
// unchanged — but NOTHING is ever written to Supabase. It's rebuilt fresh each
// time the demo opens, dated relative to today so the numbers always look current.
//
// Kept deliberately parallel to App.jsx `loadSampleData` (the signed-in seeder):
// the money+food hero, the cheapest-protein card, subscriptions, and the
// micronutrient section all light up from this one dataset.

// Stable ids so foods and logs can reference each other without a DB round-trip.
const CAT = {
  groceries: 'demo-cat-groceries',
  dining: 'demo-cat-dining',
  transport: 'demo-cat-transport',
  housing: 'demo-cat-housing',
  utilities: 'demo-cat-utilities',
  entertainment: 'demo-cat-entertainment',
  salary: 'demo-cat-salary',
}

function buildCategories() {
  return [
    { id: CAT.groceries, name: 'Groceries', kind: 'expense' },
    { id: CAT.dining, name: 'Dining & Restaurants', kind: 'expense' },
    { id: CAT.transport, name: 'Transportation', kind: 'expense' },
    { id: CAT.housing, name: 'Housing & Rent', kind: 'expense' },
    { id: CAT.utilities, name: 'Utilities', kind: 'expense' },
    { id: CAT.entertainment, name: 'Entertainment', kind: 'expense' },
    { id: CAT.salary, name: 'Salary', kind: 'income' },
  ]
}

// A realistic month of money. Recurring pairs (Salary, Rent, Netflix appearing
// in two consecutive months) are what the recurring-charge detector keys on, so
// the Subscriptions card populates. A couple of older grocery rows give the
// "vs 3-month average" food-burn line a baseline.
function buildTransactions(catById) {
  const today = todayISO()
  const rows = [
    { off: -30, amount: 3200, kind: 'income', cat: CAT.salary, note: 'Salary' },
    { off: 0, amount: 3200, kind: 'income', cat: CAT.salary, note: 'Salary' },
    { off: -62, amount: 1400, kind: 'expense', cat: CAT.housing, note: 'Rent' },
    { off: -32, amount: 1400, kind: 'expense', cat: CAT.housing, note: 'Rent' },
    { off: -2, amount: 1400, kind: 'expense', cat: CAT.housing, note: 'Rent' },
    // Three consecutive months of each recurring charge — the recurring-charge
    // detector needs 3 occurrences at a monthly cadence to qualify, so this is
    // what makes the Subscriptions card populate.
    { off: -61, amount: 15.99, kind: 'expense', cat: CAT.entertainment, note: 'Netflix' },
    { off: -30, amount: 15.99, kind: 'expense', cat: CAT.entertainment, note: 'Netflix' },
    { off: -1, amount: 15.99, kind: 'expense', cat: CAT.entertainment, note: 'Netflix' },
    { off: -59, amount: 11.99, kind: 'expense', cat: CAT.entertainment, note: 'Spotify' },
    { off: -28, amount: 11.99, kind: 'expense', cat: CAT.entertainment, note: 'Spotify' },
    { off: -3, amount: 11.99, kind: 'expense', cat: CAT.entertainment, note: 'Spotify' },
    { off: -64, amount: 65.0, kind: 'expense', cat: CAT.utilities, note: 'Electric Bill' },
    { off: -34, amount: 62.0, kind: 'expense', cat: CAT.utilities, note: 'Electric Bill' },
    { off: -4, amount: 65.0, kind: 'expense', cat: CAT.utilities, note: 'Electric Bill' },
    { off: -6, amount: 82.4, kind: 'expense', cat: CAT.groceries, note: 'Whole Foods' },
    { off: -2, amount: 54.1, kind: 'expense', cat: CAT.groceries, note: 'Trader Joes' },
    { off: -38, amount: 61.0, kind: 'expense', cat: CAT.groceries, note: 'Safeway' },
    { off: -68, amount: 73.5, kind: 'expense', cat: CAT.groceries, note: 'Costco' },
    { off: -5, amount: 44.0, kind: 'expense', cat: CAT.transport, note: 'Shell Gas' },
    { off: -3, amount: 12.75, kind: 'expense', cat: CAT.dining, note: 'Chipotle' },
    { off: -1, amount: 8.5, kind: 'expense', cat: CAT.dining, note: 'Blue Bottle Coffee' },
  ]
  return rows.map((r, i) => ({
    id: `demo-tx-${i}`,
    date: addDays(today, r.off),
    amount: r.amount,
    kind: r.kind,
    category_id: r.cat,
    note: r.note,
    source: 'manual',
    category: catById.get(r.cat) ?? null,
  }))
}

// Per-serving normalized micronutrient rows (the `id`-bearing shape the
// micronutrient section sums as Σ amount × servings). Hand-authored from typical
// label/USDA values so the section shows a believable spread of vitamins and
// minerals rather than being empty.
const N = (id, amount, unit) => ({ id, amount, unit, per: 'serving' })

// name, serving, macros, cost, and a short micronutrient profile per serving.
const FOODS = [
  {
    id: 'demo-food-chicken',
    name: 'Chicken breast',
    serving_desc: '6 oz (170 g)',
    calories: 220, protein: 40, carbs: 0, fat: 5, cost: 2.5,
    nutrients: [
      N('b3_niacin', 14, 'mg'), N('b6', 1.0, 'mg'), N('phosphorus', 220, 'mg'),
      N('selenium', 40, 'mcg'), N('potassium', 360, 'mg'),
    ],
  },
  {
    id: 'demo-food-whey',
    name: 'Whey protein',
    serving_desc: '1 scoop (31 g)',
    calories: 120, protein: 24, carbs: 3, fat: 1.5, cost: 1.1,
    nutrients: [N('calcium', 120, 'mg'), N('b12', 1.2, 'mcg'), N('sodium', 130, 'mg')],
  },
  {
    id: 'demo-food-eggs',
    name: 'Eggs',
    serving_desc: '2 large (100 g)',
    calories: 140, protein: 12, carbs: 1, fat: 10, cost: 0.6,
    nutrients: [
      N('choline', 250, 'mg'), N('vitamin_d', 2, 'mcg'), N('b12', 1.0, 'mcg'),
      N('selenium', 30, 'mcg'), N('vitamin_a', 160, 'mcg'), N('b2_riboflavin', 0.5, 'mg'),
    ],
  },
  {
    id: 'demo-food-yogurt',
    name: 'Greek yogurt',
    serving_desc: '1 cup (170 g)',
    calories: 100, protein: 17, carbs: 6, fat: 0, cost: 1.2,
    nutrients: [
      N('calcium', 200, 'mg'), N('b12', 1.3, 'mcg'), N('potassium', 240, 'mg'),
      N('phosphorus', 200, 'mg'),
    ],
  },
  {
    id: 'demo-food-rice',
    name: 'White rice',
    serving_desc: '1 cup (158 g)',
    calories: 200, protein: 4, carbs: 44, fat: 0, cost: 0.4,
    nutrients: [N('b1_thiamin', 0.2, 'mg'), N('magnesium', 20, 'mg'), N('iron', 2, 'mg')],
  },
  {
    id: 'demo-food-salmon',
    name: 'Salmon fillet',
    serving_desc: '6 oz (170 g)',
    calories: 350, protein: 34, carbs: 0, fat: 22, cost: 3.8,
    nutrients: [
      N('vitamin_d', 14, 'mcg'), N('epa', 0.5, 'g'), N('dha', 1.2, 'g'),
      N('b12', 4, 'mcg'), N('selenium', 40, 'mcg'), N('potassium', 600, 'mg'),
    ],
  },
  {
    id: 'demo-food-spinach',
    name: 'Spinach',
    serving_desc: '2 cups (60 g)',
    calories: 15, protein: 2, carbs: 2, fat: 0, cost: 0.5,
    nutrients: [
      N('vitamin_k', 300, 'mcg'), N('folate', 120, 'mcg'), N('vitamin_a', 280, 'mcg'),
      N('iron', 1.6, 'mg'), N('magnesium', 47, 'mg'), N('vitamin_c', 17, 'mg'),
    ],
  },
  {
    id: 'demo-food-almonds',
    name: 'Almonds',
    serving_desc: '1 oz (28 g)',
    calories: 165, protein: 6, carbs: 6, fat: 14, cost: 0.7,
    nutrients: [N('vitamin_e', 7, 'mg'), N('magnesium', 76, 'mg'), N('calcium', 76, 'mg')],
  },
]

function buildFoods() {
  return FOODS.map((f) => ({
    ...f,
    fdc_id: null,
    source: 'manual',
    source_ref: null,
    aliases: [],
    brand: null,
    is_stack: false,
    grade: null,
    upc: null,
  }))
}

// Meals across three days. Today is fully logged (so the Meals tab and its
// micronutrient section are populated on open); the two prior days give the
// cost/day average something to work with. One meal is left costless on purpose
// so the cost-coverage percentage reads realistically (< 100%).
function buildFoodLogs(foodsById) {
  const today = todayISO()
  const logOne = (off, meal, foodId, servings, costOverride) => {
    const f = foodsById.get(foodId)
    if (!f) return null
    return {
      food_id: f.id,
      date: addDays(today, off),
      meal,
      name: f.name,
      servings,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      cost: costOverride === undefined ? f.cost : costOverride,
      transaction_id: null,
    }
  }
  const rows = [
    logOne(0, 'breakfast', 'demo-food-yogurt', 1),
    logOne(0, 'breakfast', 'demo-food-eggs', 1),
    logOne(0, 'breakfast', 'demo-food-almonds', 1),
    logOne(0, 'lunch', 'demo-food-chicken', 1),
    logOne(0, 'lunch', 'demo-food-rice', 1),
    logOne(0, 'lunch', 'demo-food-spinach', 1),
    logOne(0, 'snack', 'demo-food-whey', 1),
    logOne(0, 'dinner', 'demo-food-salmon', 1),
    logOne(0, 'dinner', 'demo-food-rice', 1, null),
    logOne(-1, 'breakfast', 'demo-food-yogurt', 1),
    logOne(-1, 'lunch', 'demo-food-chicken', 1),
    logOne(-1, 'snack', 'demo-food-whey', 1),
    logOne(-2, 'lunch', 'demo-food-eggs', 2),
    logOne(-2, 'dinner', 'demo-food-salmon', 1),
  ].filter(Boolean)
  return rows.map((r, i) => ({ id: `demo-log-${i}`, ...r }))
}

function buildBudgets() {
  return [
    { category_id: CAT.groceries, amount: 400 },
    { category_id: CAT.dining, amount: 150 },
    { category_id: CAT.transport, amount: 120 },
    { category_id: CAT.utilities, amount: 90 },
    { category_id: CAT.entertainment, amount: 40 },
  ].map((b, i) => ({ id: `demo-budget-${i}`, ...b }))
}

export function buildDemoData() {
  const categories = buildCategories()
  const catById = new Map(categories.map((c) => [c.id, c]))
  const transactions = buildTransactions(catById)
  const foods = buildFoods()
  const foodsById = new Map(foods.map((f) => [f.id, f]))
  const foodLogs = buildFoodLogs(foodsById)
  const budgets = buildBudgets()
  const nutritionTargets = {
    calories: 2200,
    protein: 150,
    carbs: 220,
    fat: 70,
    sex: 'neutral',
    micro_targets: {},
  }
  return { categories, transactions, foods, foodLogs, budgets, nutritionTargets }
}
