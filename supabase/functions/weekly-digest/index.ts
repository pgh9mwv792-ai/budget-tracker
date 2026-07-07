import { getServiceClient } from '../_shared/auth.ts'
import { logError } from '../_shared/log-error.ts'
import { composeDigest, addDays, type Section } from '../_shared/insights.ts'

// ---------------------------------------------------------------------------
// weekly-digest: the proactive Sunday email (Phase 4). For every Pro user who
// hasn't opted out, it pulls their recent data server-side, composes a
// deterministic digest of only the sections that have signal, optionally asks
// Claude to rewrite it into a few friendly sentences, stores it (so the app can
// show it as an in-app card), and emails it via Resend.
//
// AUTH: this is called by the scheduler (pg_cron -> pg_net), NOT a browser, so
// it runs WITHOUT a Supabase JWT (see supabase/config.toml → verify_jwt=false).
// Security is a shared secret instead: the caller must send the
// x-digest-secret header matching the DIGEST_CRON_SECRET env. Fails closed if
// the secret isn't configured.
//
// The optional Claude rewrite is an INTERNAL call — it deliberately does NOT
// touch the per-user ai_usage cap, and any AI failure falls back to the
// deterministic text rather than skipping the email.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-5-20250929'
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const DIGEST_FROM = Deno.env.get('DIGEST_FROM') ?? 'Budget Tracker <onboarding@resend.dev>'
const DIGEST_CRON_SECRET = Deno.env.get('DIGEST_CRON_SECRET')
const APP_URL = Deno.env.get('APP_URL') ?? 'https://budget-tracker-rose-mu.vercel.app/'

Deno.serve(async (req) => {
  try {
    // --- shared-secret gate (no JWT on this endpoint) ---
    if (!DIGEST_CRON_SECRET) {
      throw new Error('DIGEST_CRON_SECRET is not set. Refusing to run until it is configured.')
    }
    if (req.headers.get('x-digest-secret') !== DIGEST_CRON_SECRET) {
      return json({ error: 'Unauthorized' }, 401)
    }

    // Body is optional. `preview` composes + returns without sending email or
    // requiring Resend (handy for a first manual test). `onlyUserId` limits the
    // run to one user (also handy for testing).
    const body = await req.json().catch(() => ({}))
    const preview: boolean = body?.preview === true
    const onlyUserId: string | null = body?.onlyUserId ?? null
    const today: string = body?.today ?? new Date().toISOString().slice(0, 10)

    const admin = getServiceClient()

    // --- who gets a digest: Pro users only ---
    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('user_id, status, current_period_end')
    if (subErr) throw new Error(`Could not read subscriptions: ${subErr.message}`)

    let proUserIds = (subs ?? []).filter(isProRow).map((s: any) => s.user_id as string)
    if (onlyUserId) proUserIds = proUserIds.filter((id) => id === onlyUserId)

    const results: Array<Record<string, unknown>> = []
    for (const userId of proUserIds) {
      try {
        const outcome = await processUser(admin, userId, { today, preview })
        results.push({ userId, ...outcome })
      } catch (e) {
        results.push({ userId, status: 'error', error: (e as Error).message })
      }
    }

    return json({ ran: today, count: results.length, results })
  } catch (err) {
    const message = logError('weekly-digest', err)
    return json({ error: message }, 400)
  }
})

// Same plan logic as _shared/entitlements.ts, inlined for the batch query.
function isProRow(row: { status?: string | null; current_period_end?: string | null }): boolean {
  if (!row) return false
  if (row.status === 'grandfathered') return true
  return (
    (row.status === 'active' || row.status === 'trialing') &&
    (!row.current_period_end || new Date(row.current_period_end) > new Date())
  )
}

async function processUser(
  admin: any,
  userId: string,
  { today, preview }: { today: string; preview: boolean },
): Promise<Record<string, unknown>> {
  // --- honor the opt-out toggle (missing row = opted in) ---
  const { data: prefs } = await admin
    .from('notification_prefs')
    .select('weekly_digest, email_override')
    .eq('user_id', userId)
    .maybeSingle()
  if (prefs && prefs.weekly_digest === false) {
    return { status: 'skipped', reason: 'opted out' }
  }

  // --- pull the data the digest needs (service role, filtered by user) ---
  // Transactions reach back ~13 months so the recurring detector can see annual
  // charges and a subscription's price history; the spend/food math windows
  // itself down internally, so the extra rows are harmless.
  const since400 = addDays(today, -400)
  const since40 = addDays(today, -40)

  const [{ data: transactions }, { data: foodLogs }, { data: goals }, { data: overrides }] = await Promise.all([
    admin
      .from('transactions')
      .select('date, amount, kind, note, category:categories(name, kind)')
      .eq('user_id', userId)
      .gte('date', since400),
    admin.from('food_logs').select('date, servings, protein, cost').eq('user_id', userId).gte('date', since40),
    admin.from('goals').select('name, target_amount, current_amount').eq('user_id', userId),
    admin.from('recurring_overrides').select('merchant_key, status, nickname').eq('user_id', userId),
  ])

  const { subject, sections, text, weekStart } = composeDigest(
    {
      transactions: transactions ?? [],
      foodLogs: foodLogs ?? [],
      goals: goals ?? [],
      recurringOverrides: overrides ?? [],
    },
    { today },
  )

  // Nothing worth saying this week — don't email.
  if (sections.length === 0) {
    return { status: 'skipped', reason: 'no signal' }
  }

  // --- optional friendly rewrite (best effort, never blocks the send) ---
  const summary = await rewriteWithClaude(text).catch(() => text)

  const html = renderHtml(subject, sections, summary)

  // --- store it so the app can show the in-app card (upsert per week) ---
  const { error: upErr } = await admin.from('digests').upsert(
    {
      user_id: userId,
      week_start: weekStart,
      subject,
      summary,
      sections,
      html,
      dismissed: false,
    },
    { onConflict: 'user_id,week_start' },
  )
  if (upErr) throw new Error(`Could not store digest: ${upErr.message}`)

  if (preview) {
    return { status: 'previewed', subject, sections: sections.length, summary }
  }

  // --- recipient + send ---
  let email: string | null = prefs?.email_override ?? null
  if (!email) {
    const { data: userRes } = await admin.auth.admin.getUserById(userId)
    email = userRes?.user?.email ?? null
  }
  if (!email) return { status: 'skipped', reason: 'no email on file' }

  await sendEmail(email, subject, html)
  return { status: 'sent', to: email, subject, sections: sections.length }
}

// Rewrites the deterministic text into 5–8 friendly sentences. Hard token cap.
// Throws on any failure so the caller falls back to the deterministic text.
async function rewriteWithClaude(text: string): Promise<string> {
  if (!ANTHROPIC_API_KEY) throw new Error('no anthropic key')

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system:
        'You write a short weekly money-and-food recap for a personal budgeting app. ' +
        'Rewrite the given facts into 5-8 warm, encouraging, plain sentences addressed to "you". ' +
        'Keep every number and name exactly as given — never invent figures. ' +
        'No markdown, no bullet points, no greeting or sign-off. Just the sentences.',
      messages: [{ role: 'user', content: `Here are this week's facts:\n\n${text}` }],
    }),
  })

  const data = await resp.json()
  if (!resp.ok) throw new Error(data?.error?.message ?? `Anthropic error ${resp.status}`)
  const out = (data?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')
    .trim()
  if (!out) throw new Error('empty rewrite')
  return out
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set — cannot send the digest email.')
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: DIGEST_FROM, to, subject, html }),
  })
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '')
    throw new Error(`Resend send failed (${resp.status}): ${detail}`)
  }
}

// Plain, clean HTML. Inline styles only (email clients strip <style>), with a
// footer linking back to notification settings.
function renderHtml(subject: string, sections: Section[], summary: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const summaryHtml = esc(summary)
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 12px;line-height:1.5;color:#334155;font-size:15px;">${p}</p>`)
    .join('')

  const sectionsHtml = sections
    .map(
      (s) => `
        <tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#059669;margin-bottom:2px;">${esc(
            s.title,
          )}</div>
          <div style="font-size:14px;line-height:1.5;color:#334155;">${esc(s.body)}</div>
        </td></tr>`,
    )
    .join('')

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:24px 28px 8px;">
            <div style="font-size:13px;font-weight:600;color:#059669;">Budget Tracker</div>
            <h1 style="margin:6px 0 4px;font-size:20px;color:#0f172a;">${esc(subject)}</h1>
          </td></tr>
          <tr><td style="padding:8px 28px 4px;">${summaryHtml}</td></tr>
          <tr><td style="padding:4px 28px 20px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${sectionsHtml}</table>
          </td></tr>
          <tr><td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;">
            <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.5;">
              You’re getting this because your weekly digest is on.
              <a href="${esc(APP_URL)}" style="color:#059669;">Manage email preferences</a> in Settings.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
