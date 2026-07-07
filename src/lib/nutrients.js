// Canonical micronutrient catalog + normalization. This is the single source of
// truth that turns the two very different nutrient shapes we capture —
//   • USDA foods:  [{ name, amount, unit, per:'100g', usda_number }]  (per 100 g)
//   • supplement scans: [{ name, amount, unit, per:'serving', ... }]  (per serving)
// — into a common set of stable ids with canonical units, so a scanned D3 pill
// and a USDA salmon fillet both add to the same "vitamin D" total.
//
// Design (see HANDOFF.md "Micronutrients"): normalizeNutrient does ONLY id
// mapping + unit conversion (no serving math). The food-level helper
// normalizeFoodNutrients() attaches `per:'serving'` and scales USDA per-100g
// values to the food's serving, so day totals are uniformly
//   Σ  normalized.amount × log.servings
// — exactly how the macro columns already behave. Pure module, fully unit-tested.

// Canonical unit per nutrient is always 'mcg' or 'mg' by convention below.
export const NUTRIENTS = [
  // ---- vitamins ----
  { id: 'vitamin_a', name: 'Vitamin A', unit: 'mcg', usda_numbers: ['320'], aliases: ['vitamin a', 'retinol', 'vitamin a rae', 'retinyl palmitate', 'retinyl acetate'] },
  { id: 'vitamin_c', name: 'Vitamin C', unit: 'mg', usda_numbers: ['401'], aliases: ['vitamin c', 'ascorbic acid', 'ascorbate', 'l ascorbic acid', 'sodium ascorbate'] },
  { id: 'vitamin_d', name: 'Vitamin D', unit: 'mcg', usda_numbers: ['328'], aliases: ['vitamin d', 'vitamin d3', 'vitamin d2', 'cholecalciferol', 'ergocalciferol', 'd3', 'd2'] },
  { id: 'vitamin_e', name: 'Vitamin E', unit: 'mg', usda_numbers: ['323'], aliases: ['vitamin e', 'alpha tocopherol', 'tocopherol', 'd alpha tocopherol', 'dl alpha tocopherol', 'tocopheryl acetate'] },
  { id: 'vitamin_k', name: 'Vitamin K', unit: 'mcg', usda_numbers: ['430'], aliases: ['vitamin k', 'vitamin k1', 'vitamin k2', 'phylloquinone', 'menaquinone', 'mk 7', 'mk7', 'mk 4', 'k1', 'k2'] },
  { id: 'b1_thiamin', name: 'Vitamin B1 (Thiamin)', unit: 'mg', usda_numbers: ['404'], aliases: ['thiamin', 'thiamine', 'vitamin b1', 'b1', 'thiamine hcl', 'thiamine mononitrate'] },
  { id: 'b2_riboflavin', name: 'Vitamin B2 (Riboflavin)', unit: 'mg', usda_numbers: ['405'], aliases: ['riboflavin', 'vitamin b2', 'b2', 'riboflavin 5 phosphate'] },
  { id: 'b3_niacin', name: 'Vitamin B3 (Niacin)', unit: 'mg', usda_numbers: ['406'], aliases: ['niacin', 'vitamin b3', 'b3', 'niacinamide', 'nicotinamide', 'nicotinic acid'] },
  { id: 'b5_pantothenic', name: 'Vitamin B5 (Pantothenic acid)', unit: 'mg', usda_numbers: ['410'], aliases: ['pantothenic acid', 'vitamin b5', 'b5', 'pantothenate', 'calcium pantothenate', 'd pantothenic acid'] },
  { id: 'b6', name: 'Vitamin B6', unit: 'mg', usda_numbers: ['415'], aliases: ['vitamin b6', 'b6', 'pyridoxine', 'pyridoxine hcl', 'pyridoxal 5 phosphate', 'p5p'] },
  { id: 'b12', name: 'Vitamin B12', unit: 'mcg', usda_numbers: ['418'], aliases: ['vitamin b12', 'b12', 'cobalamin', 'methylcobalamin', 'cyanocobalamin', 'adenosylcobalamin', 'hydroxocobalamin'] },
  { id: 'folate', name: 'Folate', unit: 'mcg', usda_numbers: ['435'], aliases: ['folate', 'folate dfe', 'folic acid', 'vitamin b9', 'b9', 'methylfolate', 'l methylfolate', '5 mthf', 'folinic acid'] },
  { id: 'choline', name: 'Choline', unit: 'mg', usda_numbers: ['421'], aliases: ['choline', 'choline bitartrate', 'total choline'] },
  // ---- minerals ----
  { id: 'calcium', name: 'Calcium', unit: 'mg', usda_numbers: ['301'], aliases: ['calcium', 'calcium carbonate', 'calcium citrate'] },
  { id: 'iron', name: 'Iron', unit: 'mg', usda_numbers: ['303'], aliases: ['iron', 'ferrous sulfate', 'ferrous bisglycinate', 'ferrous fumarate'] },
  { id: 'magnesium', name: 'Magnesium', unit: 'mg', usda_numbers: ['304'], aliases: ['magnesium', 'magnesium oxide', 'magnesium citrate', 'magnesium glycinate'] },
  { id: 'zinc', name: 'Zinc', unit: 'mg', usda_numbers: ['309'], aliases: ['zinc', 'zinc glycinate', 'zinc picolinate', 'zinc gluconate', 'zinc oxide'] },
  { id: 'copper', name: 'Copper', unit: 'mg', usda_numbers: ['312'], aliases: ['copper', 'copper gluconate', 'cupric oxide'] },
  { id: 'selenium', name: 'Selenium', unit: 'mcg', usda_numbers: ['317'], aliases: ['selenium', 'selenomethionine', 'sodium selenite'] },
  { id: 'potassium', name: 'Potassium', unit: 'mg', usda_numbers: ['306'], aliases: ['potassium', 'potassium chloride', 'potassium citrate'] },
  { id: 'sodium', name: 'Sodium', unit: 'mg', usda_numbers: ['307'], aliases: ['sodium', 'sodium chloride', 'salt'] },
  { id: 'phosphorus', name: 'Phosphorus', unit: 'mg', usda_numbers: ['305'], aliases: ['phosphorus', 'phosphorous'] },
  { id: 'iodine', name: 'Iodine', unit: 'mcg', usda_numbers: ['314'], aliases: ['iodine', 'potassium iodide', 'kelp'] },
]

// Display order for the curated micronutrient view (vitamins, then minerals).
export const CURATED_ORDER = NUTRIENTS.map((n) => n.id)

export const NUTRIENT_BY_ID = new Map(NUTRIENTS.map((n) => [n.id, n]))

// USDA nutrient number → catalog entry. First mapping wins (the primary number
// is listed first in usda_numbers), but every listed number resolves here.
const BY_USDA_NUMBER = new Map()
for (const n of NUTRIENTS) {
  for (const num of n.usda_numbers) if (!BY_USDA_NUMBER.has(num)) BY_USDA_NUMBER.set(num, n)
}

// Compact alias (letters+digits only) → catalog entry, for label matching.
const BY_ALIAS = new Map()
for (const n of NUTRIENTS) {
  for (const a of n.aliases) {
    const key = compact(a)
    if (!BY_ALIAS.has(key)) BY_ALIAS.set(key, n)
  }
}

// Lowercase, drop everything but letters/digits — makes "Vitamin B-12", "B12"
// and "vitamin b 12" all collapse to "vitaminb12"/"b12" for exact matching.
function compact(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

// Strip a parenthesized chemical-form note, e.g.
//   "Vitamin B12 (as methylcobalamin)" → base "Vitamin B12", form "as methylcobalamin"
// so we match on the base name but can keep the form for display.
export function splitForm(rawName) {
  const s = String(rawName ?? '').trim()
  const m = s.match(/\(([^)]*)\)/)
  const form = m ? m[1].trim() : null
  // Base = name minus any parenthetical, and cut at the first comma. USDA detail
  // names carry descriptive suffixes ("Sodium, Na"; "Vitamin C, total ascorbic
  // acid"; "Folate, DFE") that would defeat exact matching otherwise.
  const base = s
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim()
  return { base, form }
}

// mcg per one unit of mass. IU is nutrient-specific and handled separately.
const MASS_TO_MCG = { g: 1e6, mg: 1e3, mcg: 1 }

function normalizeUnit(unit) {
  const u = String(unit ?? '').trim().toLowerCase()
  if (u === 'g' || u === 'gram' || u === 'grams') return 'g'
  if (u === 'mg') return 'mg'
  if (u === 'mcg' || u === 'ug' || u === 'µg' || u === 'μg') return 'mcg'
  if (u === 'iu') return 'iu'
  return null
}

// The only IU→metric conversions we allow (matches the scanner's whitelist). Key
// is the canonical target unit's value of one IU.
const IU_CONVERSION = {
  vitamin_d: { mcg: 0.025 }, // 40 IU = 1 mcg
  vitamin_a: { mcg: 0.3 }, //  1 IU = 0.3 mcg RAE (retinol)
  vitamin_e: { mg: 0.67 }, //  1 IU = 0.67 mg d-alpha-tocopherol
}

// Convert `amount` in `fromUnit` to `entry`'s canonical unit. Returns a number,
// or null when the conversion isn't one we trust (e.g. IU for a nutrient with no
// standard IU factor) — null means "don't guess", per the spec.
function convertToCanonical(amount, fromUnit, entry) {
  const to = entry.unit // 'mcg' | 'mg'
  if (fromUnit === 'iu') {
    const factor = IU_CONVERSION[entry.id]?.[to]
    return factor == null ? null : amount * factor
  }
  if (fromUnit in MASS_TO_MCG) {
    const mcg = amount * MASS_TO_MCG[fromUnit]
    return to === 'mcg' ? mcg : mcg / MASS_TO_MCG.mg
  }
  return null
}

// Map one raw nutrient row to a canonical { id, amount, unit } or null.
//   • source 'usda'  → `raw` is the USDA nutrient number (mapped by number).
//   • source 'label' → `raw` is the printed ingredient name (alias matched;
//     parenthesized forms are ignored for matching).
// Unmappable name/number, unmappable unit, or a non-finite amount all return null
// (the entry is kept raw elsewhere, excluded from totals, never guessed).
export function normalizeNutrient(raw, amount, unit, source) {
  // Reject blanks explicitly — Number(null) and Number('') are 0, not NaN, and a
  // blank amount (e.g. a proprietary-blend row) must be excluded, not counted.
  if (amount == null || amount === '') return null
  const amt = Number(amount)
  if (!Number.isFinite(amt)) return null

  let entry = null
  let base = ''
  if (source === 'usda') {
    entry = BY_USDA_NUMBER.get(String(raw).trim()) ?? null
    // A USDA row can also arrive name-only (older data) — fall back to alias.
    if (!entry) entry = BY_ALIAS.get(compact(splitForm(raw).base)) ?? null
  } else {
    const split = splitForm(raw)
    base = split.base
    entry = BY_ALIAS.get(compact(base)) ?? null
  }
  if (!entry) return null

  const u = normalizeUnit(unit)
  if (!u) return null
  let value = convertToCanonical(amt, u, entry)
  if (value == null) return null

  // Folic acid on a label counts as 1.7 mcg DFE per mcg (the DFE convention).
  // Food folate from USDA is already DFE (number 435), so only adjust labels.
  if (source === 'label' && entry.id === 'folate' && /folic\s*acid/i.test(String(raw))) {
    value *= 1.7
  }

  return { id: entry.id, amount: value, unit: entry.unit }
}

// Turn a food's raw `nutrients` array into normalized per-serving entries
// [{ id, amount, unit, per:'serving' }], summing duplicates by id.
//   • source: the food's `source` column ('usda' | 'supplement_scan' | ...).
//   • servingScale: multiply per-100g amounts by this to reach one serving
//     (= totalGrams/100 for USDA foods). Supplement rows are already per serving,
//     so their caller passes 1.
// Raw entries are matched by USDA number for USDA foods, else by printed name.
export function normalizeFoodNutrients(rawEntries, { source, servingScale = 1 } = {}) {
  if (!Array.isArray(rawEntries)) return []
  const isUsda = source === 'usda'
  const scale = Number(servingScale) || 0
  const totals = new Map()
  for (const e of rawEntries) {
    if (!e || e.id) continue // skip already-normalized entries (idempotent)
    // USDA IU rows (e.g. "Vitamin A, IU") are redundant with the metric row we
    // already count — skip them so a food isn't double-counted. Labels legitimately
    // report IU, so only skip for USDA.
    if (isUsda && normalizeUnit(e.unit) === 'iu') continue
    const key = isUsda ? (e.usda_number ?? e.name) : e.name
    if (key == null) continue
    const norm = normalizeNutrient(key, e.amount, e.unit, isUsda ? 'usda' : 'label')
    if (!norm) continue
    const scaled = norm.amount * scale
    const prev = totals.get(norm.id)
    // USDA lists several redundant rows for one nutrient (Folate DFE/total/food);
    // they describe the same measurement, so take the MAX. A supplement label
    // lists distinct additive amounts (two magnesium forms), so SUM those.
    if (prev == null) totals.set(norm.id, scaled)
    else totals.set(norm.id, isUsda ? Math.max(prev, scaled) : prev + scaled)
  }
  return [...totals.entries()].map(([id, amount]) => ({
    id,
    amount,
    unit: NUTRIENT_BY_ID.get(id).unit,
    per: 'serving',
  }))
}

// Derive the per-100g → per-serving scale for an EXISTING food (used by the
// one-time backfill, which doesn't have the create-time factor). For USDA foods,
// the macro `calories` column is stored per serving while `nutrients` is per
// 100 g, so calories ÷ energy-per-100g recovers the serving fraction. Falls back
// to a grams count parsed from `serving_desc` ("… (150 g)" / "150 g"). Returns
// null when it can't be determined so the caller can skip rather than guess.
// Supplement/other foods are already per serving → scale 1.
export function servingScaleForFood(food) {
  if (!food) return null
  if (food.source !== 'usda') return 1
  const raw = Array.isArray(food.nutrients) ? food.nutrients : []
  const energy = raw.find(
    (e) => e && !e.id && (String(e.usda_number) === '208' || /^energy/i.test(String(e.name ?? '')))
  )
  const energyPer100g = energy ? Number(energy.amount) : NaN
  const calories = Number(food.calories)
  if (Number.isFinite(energyPer100g) && energyPer100g > 0 && Number.isFinite(calories) && calories > 0) {
    return calories / energyPer100g
  }
  const grams = parseGrams(food.serving_desc)
  return grams != null ? grams / 100 : null
}

// Pull a gram weight out of a serving description like "150 g", "1 large (50 g)",
// or "2 oz (57 g)". Prefers a parenthesized gram figure, else a trailing "N g".
function parseGrams(desc) {
  const s = String(desc ?? '')
  const paren = s.match(/\(([\d.]+)\s*g\)/i)
  if (paren) return Number(paren[1])
  const trailing = s.match(/([\d.]+)\s*g\b/i)
  if (trailing) return Number(trailing[1])
  return null
}

// ---------------------------------------------------------------------------
// RDA / UL defaults (Part 2). Adult 19–50. Values are the canonical unit above.
// `target` is the RDA or AI; `upper_limit` is the Tolerable Upper Intake Level
// (or the sodium guideline max), null when no established UL applies. These are
// the built-in starting points — users can override any of them.
// ---------------------------------------------------------------------------
const RDA = {
  vitamin_a: { male: { target: 900, upper_limit: 3000 }, female: { target: 700, upper_limit: 3000 } },
  vitamin_c: { male: { target: 90, upper_limit: 2000 }, female: { target: 75, upper_limit: 2000 } },
  vitamin_d: { male: { target: 15, upper_limit: 100 }, female: { target: 15, upper_limit: 100 } },
  vitamin_e: { male: { target: 15, upper_limit: 1000 }, female: { target: 15, upper_limit: 1000 } },
  vitamin_k: { male: { target: 120, upper_limit: null }, female: { target: 90, upper_limit: null } },
  b1_thiamin: { male: { target: 1.2, upper_limit: null }, female: { target: 1.1, upper_limit: null } },
  b2_riboflavin: { male: { target: 1.3, upper_limit: null }, female: { target: 1.1, upper_limit: null } },
  b3_niacin: { male: { target: 16, upper_limit: 35 }, female: { target: 14, upper_limit: 35 } },
  b5_pantothenic: { male: { target: 5, upper_limit: null }, female: { target: 5, upper_limit: null } },
  b6: { male: { target: 1.3, upper_limit: 100 }, female: { target: 1.3, upper_limit: 100 } },
  b12: { male: { target: 2.4, upper_limit: null }, female: { target: 2.4, upper_limit: null } },
  folate: { male: { target: 400, upper_limit: 1000 }, female: { target: 400, upper_limit: 1000 } },
  choline: { male: { target: 550, upper_limit: 3500 }, female: { target: 425, upper_limit: 3500 } },
  calcium: { male: { target: 1000, upper_limit: 2500 }, female: { target: 1000, upper_limit: 2500 } },
  iron: { male: { target: 8, upper_limit: 45 }, female: { target: 18, upper_limit: 45 } },
  magnesium: { male: { target: 400, upper_limit: null }, female: { target: 310, upper_limit: null } },
  zinc: { male: { target: 11, upper_limit: 40 }, female: { target: 8, upper_limit: 40 } },
  copper: { male: { target: 0.9, upper_limit: 10 }, female: { target: 0.9, upper_limit: 10 } },
  selenium: { male: { target: 55, upper_limit: 400 }, female: { target: 55, upper_limit: 400 } },
  potassium: { male: { target: 3400, upper_limit: null }, female: { target: 2600, upper_limit: null } },
  sodium: { male: { target: 1500, upper_limit: 2300 }, female: { target: 1500, upper_limit: 2300 } },
  phosphorus: { male: { target: 700, upper_limit: null }, female: { target: 700, upper_limit: null } },
  iodine: { male: { target: 150, upper_limit: 1100 }, female: { target: 150, upper_limit: 1100 } },
}

// Default { target, upper_limit } for one nutrient given the user's cohort.
//   sex: 'male' | 'female' | 'neutral' (unknown → average of the two targets).
export function defaultTarget(id, sex = 'neutral') {
  const row = RDA[id]
  if (!row) return { target: null, upper_limit: null }
  if (sex === 'male' || sex === 'female') return { ...row[sex] }
  // Neutral: average the RDA/AI, keep the (near-identical) UL.
  const target = round2((row.male.target + row.female.target) / 2)
  const upper_limit = row.male.upper_limit ?? row.female.upper_limit ?? null
  return { target, upper_limit }
}

// The full default target table for a cohort, keyed by nutrient id.
export function defaultTargets(sex = 'neutral') {
  const out = {}
  for (const n of NUTRIENTS) out[n.id] = defaultTarget(n.id, sex)
  return out
}

function round2(n) {
  return Math.round(n * 100) / 100
}
