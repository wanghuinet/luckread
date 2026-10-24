'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchJson, jsonHeaders } from '../../../lib/client-api.js'

type ChallengeResponse = {
  data?: { authenticated?: boolean }
  error?: { code?: string; message?: string }
}

function safeReturnTo(): string {
  const requested = new URLSearchParams(window.location.search).get('returnTo')
  return requested && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/home'
}

export default function TwoFactorChallengePage() {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [method, setMethod] = useState<'totp' | 'recovery_code'>('totp')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const normalizedCode = code.trim()
    if (!normalizedCode) {
      setError(method === 'totp' ? '请输入身份验证器中的 6 位验证码。' : '请输入备用恢复码。')
      return
    }
    if (method === 'totp' && !/^\d{6}$/.test(normalizedCode)) {
      setError('验证码应为 6 位数字。')
      return
    }
    if (method === 'recovery_code' && (normalizedCode.length > 128 || !/^[\x21-\x7E]+$/.test(normalizedCode))) {
      setError('恢复码格式无效。')
      return
    }

    setBusy(true)
    try {
      const { response, data: payload } = await fetchJson<ChallengeResponse>('/api/v1/auth/mfa/challenge/verify', {
        method: 'POST',
        credentials: 'include',
        headers: jsonHeaders({ 'Idempotency-Key': 'mfa-challenge:' + crypto.randomUUID() }),
        body: JSON.stringify({ code: normalizedCode, method }),
      })
      if (!response.ok || payload?.data?.authenticated !== true) {
        if (response.status === 429) {
          setError('验证码尝试次数过多，请稍后再试。')
        } else if (response.status === 401) {
          setError('验证码无效、已过期，或二次验证会话已失效。请重新登录再试。')
        } else if (response.status >= 500) {
          setError('二次验证服务暂时不可用，请稍后重试。')
        } else {
          setError('无法完成二次验证，请检查验证码后重试。')
        }
        return
      }

      // The W01 DTO endpoint delivers browser auth only through HttpOnly
      // Set-Cookie and never returns a raw session credential in JSON.
      setCode('')
      router.replace(safeReturnTo())
      router.refresh()
    } catch {
      setError('网络连接异常，二次验证请求未能完成。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-light-line-reply bg-main-background p-6 shadow-sm dark:border-dark-border">
        <h1 className="text-2xl font-bold text-light-primary dark:text-dark-primary">双重验证</h1>
        <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
          密码验证已完成。请继续完成第二因素验证；此步骤完成前不会建立已认证登录。
        </p>
        <form className="mt-6 grid gap-4" onSubmit={submit} aria-busy={busy} noValidate>
          <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
            {method === 'totp' ? '6 位验证码' : '备用恢复码'}
            <input
              autoComplete="one-time-code"
              autoFocus
              inputMode={method === 'totp' ? 'numeric' : 'text'}
              onChange={(event) => setCode(event.target.value)}
              value={code}
              required
              maxLength={method === 'totp' ? 6 : 128}
              className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary"
            />
          </label>
          {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
          <button
            className="rounded-full bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-wait disabled:opacity-60"
            disabled={busy}
            type="submit"
          >
            {busy ? '正在验证…' : '验证并登录'}
          </button>
          <button
            className="text-sm text-main-accent hover:underline"
            type="button"
            disabled={busy}
            onClick={() => {
              setMethod((current) => current === 'totp' ? 'recovery_code' : 'totp')
              setCode('')
              setError('')
            }}
          >
            {method === 'totp' ? '改用备用恢复码' : '改用身份验证器验证码'}
          </button>
        </form>
        <div className="mt-5 text-sm">
          <Link className="text-main-accent hover:underline" href="/login">返回登录</Link>
        </div>
      </section>
    </main>
  )
}
