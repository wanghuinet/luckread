'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const value = identifier.trim()
    setError('')
    setMessage('')
    if (!value) {
      setError('请输入注册邮箱。')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/v1/auth/password/reset/request', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ identifier: value }),
      })
      const data = await response.json().catch((): null => null) as {
        error?: { message?: string }
      } | null

      if (!response.ok) {
        throw new Error(data?.error?.message || '暂时无法发送找回邮件，请稍后重试。')
      }

      setMessage('如果该邮箱对应 LuckRead 账号，系统会发送密码找回邮件。请检查收件箱和垃圾邮件。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法发送找回邮件，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lr-auth-shell">
      <section className="lr-auth-card">
        <div className="lr-brand">LuckRead</div>
        <h1>找回密码</h1>
        <p className="lr-muted">输入注册邮箱，我们会发送密码重置说明。</p>

        <form className="lr-auth-form" onSubmit={submit} aria-busy={busy}>
          <label>
            注册邮箱
            <input
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={identifier}
            />
          </label>

          {error ? <div className="lr-error" role="alert" aria-live="assertive">{error}</div> : null}
          {message ? <div role="status" aria-live="polite">{message}</div> : null}

          <button aria-busy={busy} disabled={busy} type="submit">
            {busy ? '发送中…' : '发送找回邮件'}
          </button>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <Link className="lr-link" href="/login">返回登录</Link>
            <Link className="lr-link" href="/register">立即注册</Link>
          </div>
        </form>
      </section>
    </main>
  )
}
