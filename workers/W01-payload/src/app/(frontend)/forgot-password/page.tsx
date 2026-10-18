'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const value = identifier.trim().toLowerCase()
    setError('')
    setMessage('')
    if (!value) {
      setError('请输入注册邮箱。')
      return
    }
    if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('邮箱格式不正确，请检查拼写后重试。')
      return
    }

    setBusy(true)
    try {
      const { response, data } = await fetchJson<{ error?: { code?: string; message?: string } }>('/api/v1/auth/password/reset/request', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ identifier: value }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('请求过于频繁，请稍等片刻后再试。')
        }
        if (response.status >= 500) {
          throw new Error('密码找回邮件服务暂时不可用，请稍后重试。')
        }
        const apiMessage = getApiErrorMessage(data, '')
        throw new Error(/[\u3400-\u9fff]/.test(apiMessage) ? apiMessage : '找回请求未能处理，请检查邮箱格式后重试。')
      }

      setMessage('如果该邮箱对应 LuckRead 账号，系统会发送密码找回邮件。请检查收件箱和垃圾邮件。')
    } catch (cause) {
      setError(cause instanceof TypeError
        ? '网络连接异常，找回请求未能完成。请检查网络后重试。'
        : cause instanceof Error ? cause.message : '密码找回服务暂时不可用，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-main-background px-4 py-10 text-light-primary dark:text-dark-primary">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-5 border-x border-light-border px-6 py-8 dark:border-dark-border">
        <div className="text-2xl font-bold">LuckRead</div>
        <h1 className="text-2xl font-bold tracking-tight">找回密码</h1>
        <p className="text-sm text-light-secondary dark:text-dark-secondary">输入注册邮箱，我们会发送密码重置说明。</p>

        <form className="grid gap-4" onSubmit={submit} aria-busy={busy} noValidate>
          <label className="grid gap-2 text-sm font-semibold text-light-secondary dark:text-dark-secondary">
            注册邮箱
            <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-50 dark:border-dark-border dark:text-dark-primary"
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="you@example.com"
              required
              type="email"
              value={identifier}
            />
          </label>

          {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
          {message ? <div className="text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-live="polite">{message}</div> : null}

          <button className="min-h-11 w-full rounded-full border-0 bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50" aria-busy={busy} disabled={busy} type="submit">
            {busy ? '发送中…' : '发送找回邮件'}
          </button>

          <div className="flex justify-between gap-3">
            <Link className="text-sm font-medium text-main-accent hover:underline" href="/login">返回登录</Link>
            <Link className="text-sm font-medium text-main-accent hover:underline" href="/register">立即注册</Link>
          </div>
        </form>
      </section>
    </main>
  )
}
