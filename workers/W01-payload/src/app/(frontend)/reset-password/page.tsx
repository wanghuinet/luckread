'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { FormEvent, Suspense, useEffect, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

const MIN_PASSWORD_LENGTH = 15
const MAX_PASSWORD_LENGTH = 128

function validLength(value: string): boolean {
  const length = value.length
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

  // A recovery token is a short-lived secret. Preserve it in component state
  // but remove it from the address bar and browser history as soon as the page
  // mounts, rather than leaving it in copied URLs or later navigations.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('token')) return
    url.searchParams.delete('token')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setError('')
    setMessage('')

    if (!recoveryToken) {
      setError('缺少密码重置令牌，请使用邮件中的重置链接打开此页面。')
      return
    }
    if (!newPassword) {
      setError('请输入新密码。')
      return
    }
    if (!validLength(newPassword)) {
      setError('新密码长度必须为 15–128 个字符。建议使用长句，不要复用其他网站的密码。')
      return
    }
    if (!confirmPassword) {
      setError('请再次输入新密码以完成确认。')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致。')
      return
    }

    setBusy(true)
    try {
      const { response, data } = await fetchJson<{ error?: { code?: string; message?: string } }>('/api/v1/auth/password/reset/confirm', {
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
        if (response.status === 429) {
          throw new Error('操作过于频繁，请稍后再试。')
        }
        if (response.status >= 500) {
          throw new Error('密码重置服务暂时不可用，请稍后重试。')
        }
        const apiMessage = getApiErrorMessage(data, '')
        if (/[\u3400-\u9fff]/.test(apiMessage) && data?.error?.code?.toUpperCase() !== 'RESET_TOKEN_INVALID_OR_EXPIRED') {
          throw new Error(apiMessage)
        }
        if (response.status === 400 || response.status === 401 || response.status === 422) {
          throw new Error('重置链接无效、已过期或已使用。请重新申请密码找回邮件。')
        }
        throw new Error('密码重置未能完成，请稍后重试。')
      }

      setRecoveryToken('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage('密码已重置。现在可以使用新密码登录。')
      window.history.replaceState(null, '', '/reset-password')
    } catch (cause) {
      setError(cause instanceof TypeError
        ? '网络连接异常，密码重置请求未能完成。请检查网络后重试。'
        : cause instanceof Error ? cause.message : '密码重置暂时失败，请重新申请找回邮件。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-main-background px-4 py-10 text-light-primary dark:text-dark-primary">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-5 border-x border-light-border px-6 py-8 dark:border-dark-border">
        <div className="text-2xl font-bold">LuckRead</div>
        <h1 className="text-2xl font-bold tracking-tight">重置密码</h1>
        <p className="text-sm text-light-secondary dark:text-dark-secondary">使用邮件中的一次性重置令牌设置新的登录密码。</p>

        <form className="grid gap-4" onSubmit={submit} aria-busy={busy} noValidate>
          <label className="grid gap-2 text-sm font-semibold text-light-secondary dark:text-dark-secondary">
            重置令牌
            <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary"
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setRecoveryToken(event.target.value)}
              placeholder="邮件链接会自动填入"
              required
              type="text"
              value={recoveryToken}
            />
          </label>
          <label className="grid gap-2 text-sm font-semibold text-light-secondary dark:text-dark-secondary">
            新密码
            <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary"
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
          <label className="grid gap-2 text-sm font-semibold text-light-secondary dark:text-dark-secondary">
            确认新密码
            <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary"
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

          <p className="text-sm text-light-secondary dark:text-dark-secondary">密码长度要求：15–128 个字符。请使用较长且独一无二的密码。</p>

          {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
          {message ? <div className="text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-live="polite">{message}</div> : null}

          {!message ? (
            <button className="min-h-11 w-full rounded-full border-0 bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50" aria-busy={busy} disabled={busy} type="submit">
              {busy ? '重置中…' : '确认重置密码'}
            </button>
          ) : null}

          <Link className="text-sm font-medium text-main-accent hover:underline" href="/login">返回登录</Link>
        </form>
      </section>
    </main>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-main-background px-4 py-10 text-light-primary dark:text-dark-primary">
        <section className="mx-auto flex w-full max-w-xl flex-col gap-5 border-x border-light-border px-6 py-8 dark:border-dark-border">
          <div className="text-2xl font-bold">LuckRead</div>
          <p className="lr-muted" role="status">正在加载密码重置…</p>
        </section>
      </main>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
