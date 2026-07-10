// Pluralize the final word of a phrase when the count isn't 1 ("large egg" →
// "large eggs", "patty" → "patties"). Only used on phrases that end in a real
// noun, so a naive y→ies / +s rule is enough.
export function pluralizeLast(phrase, n) {
  if (Number(n) === 1) return phrase
  return String(phrase).replace(/(\w+)$/, (w) =>
    /y$/i.test(w) ? w.replace(/y$/i, 'ies') : `${w}s`
  )
}
