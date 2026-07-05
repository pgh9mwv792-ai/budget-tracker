import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../contexts/AuthContext'
import { downloadBackup } from '../lib/backup'

export default function Settings({ data }) {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Settings</h2>
      <ProfileSection />
      <EmailSection />
      <PasswordSection />
      <TwoFactorSection />
      <DataSection data={data} />
      <DangerZone />
    </div>
  )
}

function Card({ title, description, children }) {
  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
        {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Notice({ status }) {
  if (!status) return null
  return (
    <p className={`text-sm ${status.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
      {status.text}
    </p>
  )
}

function initialsOf(nameOrEmail) {
  const s = (nameOrEmail || '').trim()
  if (!s) return '?'
  const parts = s.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase()
}

// ---------------------------------------------------------------------------
// Profile: display name + avatar.
// ---------------------------------------------------------------------------
function ProfileSection() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.user_metadata?.display_name ?? '')
  const avatarUrl = user?.user_metadata?.avatar_url ?? null
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState(null)

  async function saveName(e) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      const { error } = await supabase.auth.updateUser({ data: { display_name: name.trim() } })
      if (error) throw error
      setStatus({ type: 'success', text: 'Display name saved.' })
    } catch (e) {
      setStatus({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setStatus({ type: 'error', text: 'Please choose an image file.' })
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setStatus({ type: 'error', text: 'Image must be under 2 MB.' })
      return
    }
    setUploading(true)
    setStatus(null)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
      const path = `${user.id}/avatar.${ext}`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      // Cache-bust so the new image shows immediately.
      const url = `${data.publicUrl}?v=${Date.now()}`
      const { error: updErr } = await supabase.auth.updateUser({ data: { avatar_url: url } })
      if (updErr) throw updErr
      setStatus({ type: 'success', text: 'Profile picture updated.' })
    } catch (e) {
      setStatus({ type: 'error', text: e.message })
    } finally {
      setUploading(false)
    }
  }

  async function removeAvatar() {
    setUploading(true)
    setStatus(null)
    try {
      const { error } = await supabase.auth.updateUser({ data: { avatar_url: null } })
      if (error) throw error
      setStatus({ type: 'success', text: 'Profile picture removed.' })
    } catch (e) {
      setStatus({ type: 'error', text: e.message })
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card title="Profile" description="Your display name and picture. Shown in the top bar.">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-16 h-16 rounded-full object-cover border border-slate-200 dark:border-slate-700" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 grid place-items-center text-xl font-semibold">
            {initialsOf(name || user?.email)}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <label className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-1.5 cursor-pointer w-fit">
            {uploading ? 'Uploading…' : avatarUrl ? 'Change picture' : 'Upload picture'}
            <input type="file" accept="image/*" onChange={uploadAvatar} disabled={uploading} className="hidden" />
          </label>
          {avatarUrl && (
            <button onClick={removeAvatar} disabled={uploading} className="text-sm text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 w-fit">
              Remove
            </button>
          )}
        </div>
      </div>

      <form onSubmit={saveName} className="flex flex-wrap gap-2 items-center">
        <input
          type="text"
          placeholder="Display name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[12rem] rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 py-2 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Save
        </button>
      </form>
      <Notice status={status} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Change email.
// ---------------------------------------------------------------------------
function EmailSection() {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      const { error } = await supabase.auth.updateUser({ email: email.trim() })
      if (error) throw error
      setStatus({
        type: 'success',
        text: 'Check your inbox — we sent a confirmation link to finish changing your email.',
      })
      setEmail('')
    } catch (e) {
      setStatus({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Email" description={`Current: ${user?.email}. Changing it requires confirming via a link sent to the new address.`}>
      <form onSubmit={submit} className="flex flex-wrap gap-2 items-center">
        <input
          type="email"
          required
          placeholder="new@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 min-w-[12rem] rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 py-2 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Update email
        </button>
      </form>
      <Notice status={status} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Change password.
// ---------------------------------------------------------------------------
function PasswordSection() {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (pw.length < 6) {
      setStatus({ type: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    if (pw !== confirm) {
      setStatus({ type: 'error', text: 'Passwords do not match.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      setStatus({ type: 'success', text: 'Password updated.' })
      setPw('')
      setConfirm('')
    } catch (e) {
      setStatus({ type: 'error', text: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card title="Password" description="Set a new password for your account.">
      <form onSubmit={submit} className="space-y-2 max-w-sm">
        <input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <input
          type="password"
          placeholder="Confirm new password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 py-2 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Update password
        </button>
      </form>
      <Notice status={status} />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Two-factor authentication (TOTP) via Supabase's native MFA.
// ---------------------------------------------------------------------------
function TwoFactorSection() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [enrolling, setEnrolling] = useState(null) // { factorId, qr, secret }
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function refresh() {
    setLoading(true)
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (!error) setEnabled((data.totp?.length ?? 0) > 0)
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  async function startEnroll() {
    setError(null)
    setBusy(true)
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: `Authenticator ${Date.now()}`,
      })
      if (error) throw error
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnroll(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { data: challenge, error: challErr } = await supabase.auth.mfa.challenge({
        factorId: enrolling.factorId,
      })
      if (challErr) throw challErr
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.id,
        code: code.trim(),
      })
      if (verifyErr) throw verifyErr
      setEnrolling(null)
      setCode('')
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function cancelEnroll() {
    if (enrolling) await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {})
    setEnrolling(null)
    setCode('')
    setError(null)
  }

  async function disable() {
    if (!window.confirm('Turn off two-factor authentication for your account?')) return
    setBusy(true)
    setError(null)
    try {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error) throw error
      for (const f of data.totp ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: f.id })
      }
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title="Two-factor authentication"
      description="Require a code from an authenticator app (Google Authenticator, 1Password, Authy, etc.) in addition to your password."
    >
      {loading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Checking…</p>
      ) : enrolling ? (
        <form onSubmit={confirmEnroll} className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            1. Scan this QR code with your authenticator app (or enter the key manually).
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            {/* qr_code is an SVG data URI returned by Supabase */}
            <img src={enrolling.qr} alt="2FA QR code" className="w-40 h-40 bg-white rounded-md p-1" />
            <div className="text-xs text-slate-500 dark:text-slate-400 break-all max-w-[12rem]">
              <span className="block mb-1 font-medium">Manual key:</span>
              <code className="text-slate-700 dark:text-slate-200">{enrolling.secret}</code>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">2. Enter the 6-digit code it shows:</p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm tracking-widest focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              type="submit"
              disabled={busy || code.length < 6}
              className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Confirm'}
            </button>
            <button type="button" onClick={cancelEnroll} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 px-2">
              Cancel
            </button>
          </div>
        </form>
      ) : enabled ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ 2FA is on</span>
          <button
            onClick={disable}
            disabled={busy}
            className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-3 py-1.5 disabled:opacity-50"
          >
            Turn off
          </button>
        </div>
      ) : (
        <button
          onClick={startEnroll}
          disabled={busy}
          className="rounded-md bg-slate-900 dark:bg-emerald-600 text-white text-sm px-4 py-2 font-medium hover:bg-slate-800 dark:hover:bg-emerald-500 transition disabled:opacity-50"
        >
          Enable 2FA
        </button>
      )}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Data export.
// ---------------------------------------------------------------------------
function DataSection({ data }) {
  return (
    <Card
      title="Your data"
      description="Download a complete copy of everything in your account as a JSON file. This happens entirely in your browser."
    >
      <button
        onClick={() => downloadBackup(data)}
        className="rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition text-sm px-4 py-2"
      >
        Export all my data
      </button>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Account deletion.
// ---------------------------------------------------------------------------
function DangerZone() {
  const { user, signOut } = useAuth()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function deleteAccount() {
    setBusy(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const { error } = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (error) {
        let message = error.message
        try {
          const details = await error.context.json()
          if (details?.error) message = details.error
        } catch {
          // keep default
        }
        throw new Error(message)
      }
      await signOut()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  const canDelete = confirm.trim().toLowerCase() === 'delete'

  return (
    <section className="bg-white dark:bg-slate-900 rounded-xl border border-red-200 dark:border-red-900/60 shadow-sm p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-red-700 dark:text-red-400">Delete account</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Permanently deletes your account ({user?.email}) and all of your data — transactions, budgets, goals,
          meals, and assistant memory. This cannot be undone. Consider exporting your data first.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          placeholder='Type "delete" to confirm'
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/40"
        />
        <button
          onClick={deleteAccount}
          disabled={!canDelete || busy}
          className="rounded-md bg-red-600 text-white text-sm px-4 py-2 font-medium hover:bg-red-500 transition disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </section>
  )
}
