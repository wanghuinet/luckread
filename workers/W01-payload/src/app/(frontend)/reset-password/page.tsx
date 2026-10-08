'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

const MIN_PASSWORD_LENGTH = 15
const MAX_PASSWORD_LENGTH = 128

function validLength(value: string): boolean {
  const length = Array.from(value).length
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
}

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const [recoveryToken, setRecoveryToken] = useState(searchParams.get('token') || '')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setError('')
    setMessage('')

    if (!recoveryToken) {
      setError('缺少密码重置令牌，请使用邮件中的重置链接打开此页面。')
      return
    }
    if (!validLength(newPassword)) {
      setError('新密码长度必须为 15–128 个 Unicode 字符。')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }

    setBusy(true)
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/auth/password/reset/confirm', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ recoveryToken, newPassword }),
      })

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, '密码重置失败，请重新申请找回邮件。'))
      }

      setRecoveryToken('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已重置。现在可以使用新密码登录。')
      window.history.replaceState(null, '', '/reset-password')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '密码重置失败，请重新申请找回邮件。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="lr-auth-shell">
      <section className="lr-auth-card">
        <div className="lr-brand">LuckRead</div>
        <h1>重置密码</h1>
        <p className="lr-muted">使用邮件中的一次性重置令牌设置新的登录密码。</p>

        <form className="lr-auth-form" onSubmit={submit} aria-busy={busy}>
          <label>
            重置令牌
            <input
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setRecoveryToken(event.target.value)}
              placeholder="邮件链接会自动填入"
              required
              type="text"
              value={recoveryToken}
            />
          </label>
          <label>
            新密码
            <input
              autoComplete="new-password"
              disabled={busy}
              maxLength={MAX_PASSWORD_LENGTH}
              minLength={MIN_PASSWORD_LENGTH}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
          </label>
          <label>
            确认新密码
            <input
              autoComplete="new-password"
              disabled={busy}
              maxLength={MAX_PASSWORD_LENGTH}
              minLength={MIN_PASSWORD_LENGTH}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>

          <p className="lr-muted">密码长度要求：15–128 个 Unicode 字符。</p>

          {error ? <div className="lr-error" role="alert" aria-live="assertive">{error}</div> : null}
          {message ? <div role="status" aria-live="polite">{message}</div> : null}

          {!message ? (
            <button aria-busy={busy} disabled={busy} type="submit">
              {busy ? '重置中…' : '确认重置密码'}
            </button>
          ) : null}

          <Link className="lr-link" href="/login">返回登录</Link>
        </form>
      </section>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main className="lr-auth-shell">
        <section className="lr-auth-card">
          <div className="lr-brand">LuckRead</div>
          <p className="lr-muted" role="status">正在加载密码重置…</p>
        </section>
      </main>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
