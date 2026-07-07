// Bundles all of the user's data into a single JSON file and triggers a
// download. Purely client-side — the data is already loaded in the app, so
// nothing new is fetched or sent anywhere.
import { todayISO } from './dateHelpers'

export function downloadBackup(data) {
  const payload = {
    app: 'budget-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-tracker-backup-${todayISO()}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
