'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchJson, getApiErrorMessage, jsonHeaders } from '../../../lib/client-api.js'

type ApiResponse = {
  data?: {
    twoFactorRequired?: boolean
    twoFactorMethods?: string[]
  }
  error?: {
    code?: string
    message?: string
  }
}

type ApiError = ApiResponse

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const verifiedNotice = searchParams.get('verified') === '1' ? '邮箱验证成功，请登录。' : ''
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsVerification, setNeedsVerification] = useState(false)
  const [verificationBusy, setVerificationBusy] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState('')

  async function resendVerification() {
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setVerificationMessage('请先填写注册邮箱。')
      return
    }
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setVerificationMessage('邮箱格式不正确，请检查后重试。')
      return
    }

    setVerificationBusy(true)
    setVerificationMessage('')
    try {
      const { response, data } = await fetchJson<ApiError | null>('/api/v1/auth/verification/send', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ identity: normalizedEmail }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          setVerificationMessage('请求过于频繁，请稍后再试。')
        } else if (response.status >= 500) {
          setVerificationMessage('验证邮件服务暂时不可用，请稍后重试。')
        } else {
          const apiMessage = getApiErrorMessage(data, '')
          setVerificationMessage(/[\u3400-\u9fff]/.test(apiMessage) ? apiMessage : '无法处理验证邮件请求，请检查邮箱格式后重试。')
        }
        return
      }

      setVerificationMessage('如果该邮箱尚未验证，系统已受理验证邮件发送请求。请检查收件箱和垃圾邮件。')
    } catch {
      setVerificationMessage('网络连接异常，验证邮件请求未能完成。请检查网络后重试。')
    } finally {
      setVerificationBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNeedsVerification(false)
    setVerificationMessage('')

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('请输入邮箱地址。')
      return
    }
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('邮箱格式不正确，请检查后重试。')
      return
    }
    if (!password) {
      setError('请输入登录密码。')
      return
    }

    setBusy(true)
    try {
      const { response, data } = await fetchJson<ApiResponse | null>('/api/v1/auth/login', {
        method: 'POST',
        headers: jsonHeaders(),
        credentials: 'include',
        body: JSON.stringify({ identity: normalizedEmail, credential: password }),
      })
      if (!response.ok) {
        const errorCode = data?.error?.code?.toUpperCase()
        if (response.status === 403 && errorCode === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true)
          setError('该邮箱尚未验证。请先完成邮箱验证，或重新发送验证邮件。')
        } else if (response.status === 429) {
          setError('登录尝试过于频繁，请稍后再试。')
        } else if (response.status >= 500) {
          setError('登录服务暂时不可用，请稍后重试。')
        } else if (response.status === 400 || response.status === 401 || response.status === 422) {
          setError('邮箱或密码不正确，请检查后重试。')
        } else {
          const apiMessage = getApiErrorMessage(data, '')
          setError(/[\u3400-\u9fff]/.test(apiMessage) ? apiMessage : '登录失败，请稍后重试。')
        }
        return
      }
      const requestedReturnTo = new URLSearchParams(window.location.search).get('returnTo')
      const returnTo = requestedReturnTo && requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
        ? requestedReturnTo
        : '/home'
      if (data?.data?.twoFactorRequired === true) {
        router.push('/login/two-factor?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      router.push(returnTo)
    } catch {
      setError('网络连接异常，登录请求未能完成。请检查网络后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="grid gap-4" onSubmit={submit} aria-busy={busy} noValidate>
      {verifiedNotice ? <div className="rounded-xl bg-main-sidebar-background p-3 text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-live="polite">{verifiedNotice}</div> : null}
      <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
        邮箱
        <input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary" />
      </label>
      <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
        密码
        <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required type="password" value={password} className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary" />
      </label>
      {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
      {needsVerification ? (
        <div role="group" aria-label="邮箱验证">
          <button className="rounded-full border border-light-line-reply px-4 py-2 text-sm font-bold text-main-accent hover:bg-main-accent/10 disabled:opacity-50 dark:border-dark-border" type="button" disabled={verificationBusy} onClick={() => void resendVerification()}>
            {verificationBusy ? '正在发送…' : '重新发送验证邮件'}
          </button>
          {verificationMessage ? <div className="rounded-xl bg-main-sidebar-background p-3 text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-live="polite">{verificationMessage}</div> : null}
        </div>
      ) : null}
      <button className="rounded-full bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-wait disabled:opacity-60" aria-busy={busy} disabled={busy} type="submit">{busy ? '登录中…' : '登录'}</button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link className="text-center text-sm text-main-accent hover:underline" href="/forgot-password">忘记密码？</Link>
        <Link className="text-center text-sm text-main-accent hover:underline" href="/register">还没有账号？立即注册</Link>
      </div>
      <Link className="text-center text-sm text-main-accent hover:underline" href="/verify-email">收不到验证邮件？点此重发</Link>
      <Link className="text-center text-sm text-main-accent hover:underline" href="/login/mfa">已登录账号？配置双重验证</Link>
    </form>
  )
}
