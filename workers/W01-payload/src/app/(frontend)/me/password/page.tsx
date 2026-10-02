'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

const MIN_PASSWORD_LENGTH = 15
const MAX_PASSWORD_LENGTH = 128

function validLength(value: string): boolean {
  const length = Array.from(value).length
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
}

export default function PasswordChangePage() {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
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

    if (!validLength(currentPassword) || !validLength(newPassword)) {
      setError('密码长度必须为 15–128 个 Unicode 字符。')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }

    if (currentPassword === newPassword) {
      setError('新密码不能与当前密码相同。')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/v1/auth/password/change', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'password-change-' + crypto.randomUUID(),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      if (response.status === 401) {
        router.replace('/login?returnTo=' + encodeURIComponent(window.location.pathname))
        return
      }

      const data = await response.json().catch((): null => null) as {
        error?: { message?: string }
      } | null

      if (!response.ok) {
        throw new Error(data?.error?.message || '密码修改失败，请稍后重试。')
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已修改。当前设备会继续保持登录，其他登录会话由系统按认证规则处理。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '密码修改失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 680, margin: '48px auto', padding: '0 20px' }}>
      <header>
        <p style={{ margin: 0, fontSize: 13, letterSpacing: 1.5, color: '#666' }}>ACCOUNT SECURITY</p>
        <h1 style={{ margin: '8px 0 4px' }}>修改密码</h1>
        <p style={{ margin: 0, color: '#666', lineHeight: 1.7 }}>
          使用当前密码验证身份，再设置新的登录密码。
        </p>
      </header>

      <form
        aria-busy={busy}
        onSubmit={submit}
        style={{ marginTop: 32, display: 'grid', gap: 18 }}
      >
        <label>
          <span>当前密码</span>
          <input
            autoComplete="current-password"
            disabled={busy}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>

        <label>
          <span>新密码</span>
          <input
            autoComplete="new-password"
            disabled={busy}
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>

        <label>
          <span>确认新密码</span>
          <input
            autoComplete="new-password"
            disabled={busy}
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
            style={{ display: 'block', width: '100%', marginTop: 6 }}
          />
        </label>

        <p style={{ margin: 0, color: '#666', fontSize: 12 }}>
          密码长度要求：15–128 个 Unicode 字符。
        </p>

        {error ? <p role="alert">{error}</p> : null}
        {message ? <p role="status">{message}</p> : null}

        <div style={{ display: 'flex', gap: 12 }}>
          <button disabled={busy} type="submit">
            {busy ? '修改中…' : '确认修改'}
          </button>
          <Link href="/me/profile">返回个人资料</Link>
        </div>
      </form>
    </main>
  )
}
