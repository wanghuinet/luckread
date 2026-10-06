'use client'

import { useState } from 'react'

export default function PayloadAdminLogoutButton() {
  const [busy, setBusy] = useState(false)

  async function logout() {
    if (busy) return
    setBusy(true)
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      })
    } finally {
      window.location.assign('/login?returnTo=/admin')
    }
  }

  return (
    <button type="button" onClick={logout} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
