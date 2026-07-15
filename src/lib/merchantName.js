// Turns a raw bank/card memo into a short, human merchant name for display.
// Bank descriptors are noisy — "RECURRING PAYMENT AUTHORIZED ON 06/19 NYTIMES
// DISC* NY S466170595160152 CARD 5346" should read as "NY Times". We do this in
// two passes: a small map of common brands (so well-known merchants look exactly
// right), then a generic heuristic that strips the boilerplate prefix, trailing
// reference/card/location tokens, and title-cases what's left.

// Well-known merchants whose canonical spelling isn't just title-case. Matched
// against the raw memo (case-insensitive substring), first hit wins.
const BRANDS = [
  [/ny ?times|new york times/i, 'NY Times'],
  [/netflix/i, 'Netflix'],
  [/spotify/i, 'Spotify'],
  [/hulu/i, 'Hulu'],
  [/disney ?\+|disneyplus/i, 'Disney+'],
  [/youtube/i, 'YouTube'],
  [/amazon|amzn/i, 'Amazon'],
  [/apple\.com|itunes|apple bill/i, 'Apple'],
  [/google/i, 'Google'],
  [/microsoft|msft/i, 'Microsoft'],
  [/uber ?eats/i, 'Uber Eats'],
  [/uber/i, 'Uber'],
  [/lyft/i, 'Lyft'],
  [/doordash/i, 'DoorDash'],
  [/grubhub/i, 'Grubhub'],
  [/starbucks/i, 'Starbucks'],
  [/chipotle/i, 'Chipotle'],
  [/qdoba/i, 'Qdoba'],
  [/wholefds|whole ?foods/i, 'Whole Foods'],
  [/trader ?joe/i, "Trader Joe's"],
  [/safeway/i, 'Safeway'],
  [/costco/i, 'Costco'],
  [/walmart|wal-mart/i, 'Walmart'],
  [/target/i, 'Target'],
  [/autozone/i, 'AutoZone'],
  [/shell/i, 'Shell'],
  [/chevron/i, 'Chevron'],
  [/venmo/i, 'Venmo'],
  [/paypal/i, 'PayPal'],
  [/cash ?app/i, 'Cash App'],
  [/comcast|xfinity/i, 'Xfinity'],
  [/verizon/i, 'Verizon'],
  [/t-?mobile/i, 'T-Mobile'],
  [/at&t|at and t/i, 'AT&T'],
  [/planet ?fit/i, 'Planet Fitness'],
]

// Boilerplate words a memo carries that are never part of the merchant name.
const NOISE = new Set([
  'recurring', 'payment', 'authorized', 'auth', 'on', 'purchase', 'pos', 'debit',
  'credit', 'card', 'checkcard', 'ach', 'web', 'ppd', 'des', 'id', 'indn', 'llc',
  'inc', 'online', 'withdrawal', 'deposit', 'preauthorized', 'point', 'of', 'sale',
  'transaction', 'ref', 'trace', 'seq', 'xx', 'x',
])

const STATES = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il',
  'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt',
  'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri',
  'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy',
])

function titleCase(s) {
  return s
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

export function cleanMerchantName(note, fallback = 'Transaction') {
  const raw = String(note ?? '').trim()
  if (!raw) return fallback

  for (const [re, name] of BRANDS) {
    if (re.test(raw)) return name
  }

  // Drop everything up to and including a leading MM/DD(/YY) transaction date.
  let s = raw
  const date = s.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/)
  if (date) s = s.slice(date.index + date[0].length)
  // Cut trailing descriptor refs that hang off a '*' (e.g. "DISC*466...").
  s = s.split('*')[0]

  const kept = []
  for (const rawTok of s.split(/\s+/)) {
    const tok = rawTok.replace(/[^a-zA-Z&]/g, '')
    if (!tok) continue
    const low = tok.toLowerCase()
    if (/\d/.test(rawTok)) {
      if (kept.length) break // hit a reference/card number → name is done
      continue
    }
    if (NOISE.has(low)) {
      if (kept.length) break
      continue
    }
    if (kept.length && STATES.has(low)) break // trailing state code ends it
    kept.push(tok)
    if (kept.length >= 3) break
  }
  // Trim a dangling conjunction the token walk may have left ("Noodles And").
  while (kept.length > 1 && ['and', 'the'].includes(kept[kept.length - 1].toLowerCase())) kept.pop()

  const cleaned = kept.join(' ').trim()
  return cleaned ? titleCase(cleaned) : fallback
}
