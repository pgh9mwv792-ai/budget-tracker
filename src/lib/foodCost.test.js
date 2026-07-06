import { describe, it, expect } from 'vitest'
import { costPerDay, costPerProtein, computeFoodCost, classifyFoodTxn } from './foodCost'

const TODAY = '2026-07-06'

// The In-N-Out example: a $11.83 restaurant charge (Plaid) on 07/05, and the
// food log the assistant created from it — same amount, linked by transaction_id.
const innOutTxn = {
  id: 'txn-innout',
  source: 'plaid',
  kind: 'expense',
  amount: 11.83,
  date: '2026-07-05',
  note: 'IN-N-OUT BURGER #123 AUTHORIZED ON 07/05',
}
const innOutLog = {
  id: 'log-innout',
  date: '2026-07-05',
  meal: 'lunch',
  name: 'In-N-Out #1 combo',
  servings: 1,
  protein: 37,
  cost: 11.83,
  transaction_id: 'txn-innout',
}

describe('classifyFoodTxn', () => {
  it('tags the In-N-Out charge as a restaurant expense', () => {
    expect(classifyFoodTxn(innOutTxn)).toBe('restaurant')
  })
})

describe('no double-counting of a transaction-linked meal', () => {
  it('counts the $11.83 exactly once on the transaction-spend side', () => {
    const spend = costPerDay([innOutTxn], { today: TODAY })
    expect(spend.restaurant).toBeCloseTo(11.83, 2)
    expect(spend.total).toBeCloseTo(11.83, 2)
    expect(spend.txnCount).toBe(1)
  })

  it('counts the $11.83 exactly once on the logged-cost side', () => {
    const protein = costPerProtein([innOutLog], { today: TODAY })
    expect(protein.cost).toBeCloseTo(11.83, 2)
    expect(protein.protein).toBeCloseTo(37, 2)
    expect(protein.costPerGram).toBeCloseTo(11.83 / 37, 5)
  })

  it('keeps the two totals separate — the dollar is never summed onto itself', () => {
    // computeFoodCost sees BOTH the transaction and its linked log; each total
    // must show 11.83, and there is no combined field summing them to 23.66.
    const fc = computeFoodCost(
      { transactions: [innOutTxn], foodLogs: [innOutLog], foods: [] },
      { today: TODAY }
    )
    expect(fc.spend.restaurant).toBeCloseTo(11.83, 2)
    expect(fc.protein.cost).toBeCloseTo(11.83, 2)
  })
})

describe('log-level cost wins over a library default', () => {
  it('sums each log by its own snapshot cost (restaurant + home side by side)', () => {
    // A home meal whose library food's default cost is irrelevant here — only
    // the per-log cost is summed, so a stored default can never double up.
    const homeLog = {
      id: 'log-chicken',
      date: '2026-07-05',
      meal: 'dinner',
      name: 'Chicken breast',
      servings: 2,
      protein: 20,
      cost: 2.0, // the log's own cost (per serving)
    }
    const protein = costPerProtein([innOutLog, homeLog], { today: TODAY })
    // 11.83 (restaurant) + 2.00 * 2 servings (home) = 15.83, counted once each.
    expect(protein.cost).toBeCloseTo(15.83, 2)
    expect(protein.protein).toBeCloseTo(37 + 40, 2)
  })
})
