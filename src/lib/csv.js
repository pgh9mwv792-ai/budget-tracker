// Builds a CSV string from transactions and triggers a browser download.
import { todayISO } from './dateHelpers'

function escapeCell(value) {
  const s = value == null ? '' : String(value)
  // Wrap in quotes and double any embedded quotes if the cell contains a
  // comma, quote, or newline.
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function transactionsToCsv(transactions) {
  const header = ['Date', 'Type', 'Amount', 'Category', 'Note', 'Source']
  const rows = transactions.map((t) => [
    t.date,
    t.kind,
    Number(t.amount).toFixed(2),
    t.category?.name ?? '',
    t.note ?? '',
    t.source ?? '',
  ])
  return [header, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n')
}

export function downloadTransactionsCsv(transactions) {
  const csv = transactionsToCsv(transactions)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  const stamp = todayISO()
  link.href = url
  link.download = `budget-transactions-${stamp}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
