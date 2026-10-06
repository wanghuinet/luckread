'use client'

import { FormEvent, useState } from 'react'

export default function AdminLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const response = await fetch('/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include', body: JSON.stringify({ identity: email.trim(), credential: password }) })
      if (!response.ok) { const payload = await response.json().catch(() => null as { error?: { message?: string } } | null); setError(payload?.error?.message || 'Authentication failed'); return }
      window.location.assign('/admin')
    } catch { setError('Authentication service unavailable') } finally { setBusy(false) }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: '100%', maxWidth: 420, display: 'grid', gap: 16 }}>
        <h1>LuckRead Admin</h1>
        <label>Email<input autoComplete='email' required type='email' value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label>Password<input autoComplete='current-password' required type='password' value={password} onChange={event => setPassword(event.target.value)} /></label>
        {error ? <p role='alert'>{error}</p> : null}
        <button disabled={busy} type='submit'>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
