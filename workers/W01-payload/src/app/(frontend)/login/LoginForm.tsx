'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { fetchJson, getApiErrorMessage, jsonHeaders } from '../../../lib/client-api.js'

type ApiError = {
  error?: {
    code?: string
    message?: string
  }
}

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

    setVerificationBusy(true)
    setVerificationMessage('')
    try {
      const { response, data } = await fetchJson<ApiError | null>('/api/v1/auth/verification/send', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ identity: normalizedEmail }),
      })

      if (!response.ok) {
        setVerificationMessage(getApiErrorMessage(data, '验证邮件暂时无法发送，请稍后重试。'))
        return
      }

      setVerificationMessage('如果该邮箱尚未验证，系统已受理验证邮件发送请求。请检查收件箱和垃圾邮件。')
    } catch {
      setVerificationMessage('网络异常，验证邮件请求未能完成。请稍后重试。')
    } finally {
      setVerificationBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setNeedsVerification(false)
    setVerificationMessage('')
    setBusy(true)
    try {
      const { response, data } = await fetchJson<ApiError | null>('/api/v1/auth/login', {
        method: 'POST',
        headers: jsonHeaders(),
        credentials: 'include',
        body: JSON.stringify({ identity: email.trim(), credential: password }),
      })
      if (!response.ok) {
        const errorCode = data?.error?.code?.toUpperCase()
        if (response.status === 403 && errorCode === 'EMAIL_NOT_VERIFIED') {
          setNeedsVerification(true)
          setError('该邮箱尚未验证。请先完成邮箱验证，或重新发送验证邮件。')
        } else {
          setError(getApiErrorMessage(data, '登录失败，请检查账号和密码。'))
        }
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
      {verifiedNotice ? <div className="lr-muted" role="status" aria-live="polite">{verifiedNotice}</div> : null}
      <label>
        邮箱
        <input autoComplete="email" inputMode="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required type="email" value={email} />
      </label>
      <label>
        密码
        <input autoComplete="current-password" onChange={(event) => setPassword(event.target.value)} placeholder="输入密码" required type="password" value={password} />
      </label>
      {error ? <div className="lr-error" role="alert" aria-live="assertive">{error}</div> : null}
      {needsVerification ? (
        <div role="group" aria-label="邮箱验证">
          <button type="button" disabled={verificationBusy} onClick={() => void resendVerification()}>
            {verificationBusy ? '正在发送…' : '重新发送验证邮件'}
          </button>
          {verificationMessage ? <div className="lr-muted" role="status" aria-live="polite">{verificationMessage}</div> : null}
        </div>
      ) : null}
      <button aria-busy={busy} disabled={busy} type="submit">{busy ? '登录中…' : '登录'}</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <Link className="lr-link" href="/forgot-password">忘记密码？</Link>
        <Link className="lr-link" href="/register">还没有账号？立即注册</Link>
      </div>
    </form>
  )
}
