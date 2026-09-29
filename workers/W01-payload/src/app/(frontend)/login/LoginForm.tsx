'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

const deviceKey = 'luckread.deviceId'

function getDeviceId() {
  const existing = sessionStorage.getItem(deviceKey)
  if (existing) return existing
  const value = crypto.randomUUID()
  sessionStorage.setItem(deviceKey, value)
  return value
}

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identity: email.trim(),
          credential: password,
          deviceId: getDeviceId(),
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.accessToken || !data?.refreshToken) {
        setError(data?.error?.message || '登录失败，请检查账号和密码。')
        return
      }

      sessionStorage.setItem('luckread.accessToken', data.accessToken)
      sessionStorage.setItem('luckread.refreshToken', data.refreshToken)
      sessionStorage.setItem('luckread.expiresIn', String(data.expiresIn ?? ''))
      sessionStorage.setItem('luckread.layer', String(data.layer ?? ''))
      router.push('/publish')
    } catch {
      setError('网络异常，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="lr-auth-form" onSubmit={submit}>
      <label>
        邮箱
        <input
          autoComplete="email"
          inputMode="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
      </label>
      <label>
        密码
        <input
          autoComplete="current-password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="输入密码"
          required
          type="password"
          value={password}
        />
      </label>
      {error ? <div className="lr-error" role="alert">{error}</div> : null}
      <button disabled={busy} type="submit">
        {busy ? '登录中…' : '登录'}
      </button>
      <a className="lr-link" href="/register">还没有账号？立即注册</a>
    </form>
  )
}
