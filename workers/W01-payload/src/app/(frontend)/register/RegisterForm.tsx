'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

type RegisterFormProps = {
  policyVersion: string
}

type RegistrationResponse = {
  userId: string
  accountState: 'PENDING_VERIFICATION'
}

type ApiError = {
  error?: {
    code?: string
    message?: string
  }
}

export default function RegisterForm({ policyVersion }: RegisterFormProps) {
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<RegistrationResponse | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setResult(null)

    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim()

    if (!normalizedEmail || !normalizedUsername || !password) {
      setStatus('error')
      setMessage('请完整填写邮箱、用户名和密码。')
      return
    }

    if (password !== confirmPassword) {
      setStatus('error')
      setMessage('两次输入的密码不一致。')
      return
    }

    if (!consent) {
      setStatus('error')
      setMessage('请先同意用户协议和隐私政策。')
      return
    }

    setStatus('submitting')

    try {
      const response = await fetch('/auth/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          identityType: 'email',
          identity: normalizedEmail,
          credential: password,
          username: normalizedUsername,
          consent: {
            purpose: 'ACCOUNT_REGISTRATION',
            policyVersion,
          },
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | RegistrationResponse
        | ApiError
        | null

      if (!response.ok) {
        const apiMessage: string | undefined =
          payload && 'error' in payload ? payload.error?.message : undefined
        throw new Error(apiMessage || '注册暂时无法完成，请稍后重试。')
      }

      if (
        !payload ||
        !('userId' in payload) ||
        payload.accountState !== 'PENDING_VERIFICATION'
      ) {
        throw new Error('注册结果无法确认，请稍后检查账号状态。')
      }

      setResult(payload)
      setStatus('success')
      setEmail('')
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setConsent(false)
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : '注册暂时无法完成，请稍后重试。')
    }
  }

  return (
    <main className="registerPage">
      <section className="registerShell" aria-labelledby="register-title">
        <div className="registerBrand">
          <div className="registerMark" aria-hidden="true">
            L
          </div>
          <span>LuckRead</span>
        </div>

        <div className="registerCard">
          <div className="registerIntro">
            <span className="registerEyebrow">JOIN LUCKREAD</span>
            <h1 id="register-title">创建你的 LuckRead 账号</h1>
            <p>注册后即可开始阅读、关注作者，并逐步建立你的个人主页。</p>
          </div>

          {status === 'success' && result ? (
            <div className="registerSuccess" role="status">
              <div className="successIcon" aria-hidden="true">
                ✓
              </div>
              <h2>注册成功</h2>
              <p>
                你的账号已经创建，当前状态为“待验证”。
                <br />
                用户 ID：{result.userId}
              </p>
              <Link className="registerPrimaryButton" href="/">
                返回 LuckRead
              </Link>
            </div>
          ) : (
            <form className="registerForm" onSubmit={handleSubmit} noValidate>
              <label className="registerField">
                <span>邮箱</span>
                <input
                  autoComplete="email"
                  inputMode="email"
                  name="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={email}
                />
              </label>

              <label className="registerField">
                <span>用户名</span>
                <input
                  autoComplete="username"
                  name="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="你的公开用户名"
                  type="text"
                  value={username}
                />
              </label>

              <label className="registerField">
                <span>密码</span>
                <input
                  autoComplete="new-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="设置你的登录密码"
                  type="password"
                  value={password}
                />
              </label>

              <label className="registerField">
                <span>确认密码</span>
                <input
                  autoComplete="new-password"
                  name="confirmPassword"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="再次输入密码"
                  type="password"
                  value={confirmPassword}
                />
              </label>

              <label className="registerConsent">
                <input
                  checked={consent}
                  onChange={(event) => setConsent(event.target.checked)}
                  type="checkbox"
                />
                <span>我已阅读并同意 LuckRead 用户协议和隐私政策。</span>
              </label>

              {status === 'error' ? (
                <p className="registerError" role="alert">
                  {message}
                </p>
              ) : null}

              <button
                className="registerPrimaryButton"
                disabled={status === 'submitting'}
                type="submit"
              >
                {status === 'submitting' ? '正在创建账号…' : '创建账号'}
              </button>
            </form>
          )}

          <div className="registerFooter">
            <span>已有 LuckRead 账号？</span>
            <Link href="/admin/login">登录</Link>
          </div>
        </div>

        <p className="registerCopyright">© {new Date().getFullYear()} LuckRead</p>
      </section>
    </main>
  )
}
