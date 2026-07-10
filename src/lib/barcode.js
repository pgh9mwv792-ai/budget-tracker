// Pure helpers for the barcode-scan food flow. Kept free of React/network so the
// UPC normalization, dedupe, and plausibility rules can be unit-tested and reused
// by both the scanner component and the assistant.

// Digits-only form of a scanned code, preserving leading zeros (a UPC-A is 12
// digits, EAN-13 is 13, EAN-8 is 8, ITF-14 is 14). Returns null for anything
// that isn't a plausible product barcode length, so junk decodes are ignored.
export function normalizeUpc(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (![8, 12, 13, 14].includes(digits.length)) return null
  return digits
}

// Two barcodes refer to the same product even when one carries a leading zero
// (UPC-A "0..." is the same GTIN as the 12-digit form, and EAN-13 zero-pads to
// 14). Compare by their trailing significant digits so "0016000275287" matches
// "16000275287". We keep the last 13 (the longest common GTIN width we accept).
export function upcKey(upc) {
  const digits = String(upc ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return digits.replace(/^0+/, '').padStart(13, '0')
}

// Find an existing library food that carries this UPC, so a re-scan re-logs the
// saved food instead of creating a duplicate. Matches on the leading-zero-robust
// key above.
export function findFoodByUpc(foods, upc) {
  const key = upcKey(upc)
  if (!key) return null
  return foods.find((f) => f.upc && upcKey(f.upc) === key) ?? null
}

// Open Food Facts is community-maintained (anyone can edit a product), so its
// numbers are treated like any web-sourced value: sanity-checked before we trust
// them. Rejects a per-100g macro set whose calories are wildly inconsistent with
// 4/4/9 Atwater math, or whose macro grams exceed 100 g per 100 g of food.
// Returns { ok, reason } — reason is a short human string when ok is false.
export function plausibleMacros({ calories, protein, carbs, fat } = {}) {
  const cal = num(calories)
  const p = num(protein)
  const c = num(carbs)
  const f = num(fat)

  // Per 100 g, no single macro (or their sum) can exceed the food's own weight.
  // A little slack for rounding.
  if (p > 101 || c > 101 || f > 101) return { ok: false, reason: 'a macro exceeds 100 g per 100 g' }
  if (p + c + f > 105) return { ok: false, reason: 'macros add up to more than 100 g' }

  const atwater = 4 * p + 4 * c + 9 * f
  if (cal > 0 && atwater > 0) {
    // Generous band — fiber, sugar alcohols, and rounding all shift the sum, but
    // a value off by more than the band in either direction isn't believable.
    const lo = cal * 0.5 - 40
    const hi = cal * 1.7 + 60
    if (atwater < lo || atwater > hi) {
      return { ok: false, reason: 'calories disagree with protein/carb/fat' }
    }
  }
  return { ok: true, reason: null }
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
