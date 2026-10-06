'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ identity: email.trim(), credential: password }),
      })
      const data = await response.json().catch((): null => null)
      if (!response.ok) {
        setError(data?.error?.message || '登录失败，请检查账号和密码。')
        return
      }
      const requestedReturnTo = new URLSearchParams(window.location.search).get('returnTo')
      const returnTo = requestedReturnTo && requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
        ? requestedReturnTo
        : '/publish'
      router.push(returnTo)
    } catch {
      setError('网络异常，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="lr-auth-form" onSubmit={submit} aria-busy={busy}>
      <label>
        邮箱
        <input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
      </label>
      <label>
        密码
        <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" required type="password" value={password} />
      </label>
      {error ? <div className="lr-error" role="alert" aria-live="assertive">{error}</div> : null}
      <button aria-busy={busy} disabled={busy} type="submit">{busy ? '登录中…' : '登录'}</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Link className="lr-link" href="/forgot-password">忘记密码？</Link>
        <Link className="lr-link" href="/register">还没有账号？立即注册</Link>
      </div>
    </form>
  )
}
