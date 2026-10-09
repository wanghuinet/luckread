'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'

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
  const [registeredEmail, setRegisteredEmail] = useState('')
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [verificationMessage, setVerificationMessage] = useState('')

  async function sendVerificationEmail(identity: string) {
    setVerificationStatus('sending')
    setVerificationMessage('')

    try {
      const { response, data: payload } = await fetchJson<ApiError | null>('/api/v1/auth/verification/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identity }),
      })

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, '验证邮件暂时无法发送，请点击重试。'))
      }

      setVerificationStatus('sent')
      setVerificationMessage('验证邮件已发送至 ' + identity + '。请打开邮件中的链接完成验证。')
    } catch (error) {
      setVerificationStatus('error')
      setVerificationMessage(error instanceof Error ? error.message : '验证邮件暂时无法发送，请点击重试。')
    }
  }

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
      const { response, data: payload } = await fetchJson<RegistrationResponse | ApiError>('/api/v1/auth/register', {
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

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, '注册暂时无法完成，请稍后重试。'))
      }

      if (
        !payload ||
        !('userId' in payload) ||
        payload.accountState !== 'PENDING_VERIFICATION'
      ) {
        throw new Error('注册结果无法确认，请稍后检查账号状态。')
      }

      setResult(payload)
      setRegisteredEmail(normalizedEmail)
      setStatus('success')
      setEmail('')
      setUsername('')
      setPassword('')
      setConfirmPassword('')
      setConsent(false)
      await sendVerificationEmail(normalizedEmail)
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
            <div className="registerSuccess" role="status" aria-live="polite">
              <div className="successIcon" aria-hidden="true">
                ✓
              </div>
              <h2>注册成功</h2>
              <p>
                你的账号已经创建，当前状态为“待验证”。
                <br />
                用户 ID：{result.userId}
              </p>
              {verificationMessage ? (
                <p
                  className={verificationStatus === 'error' ? 'registerError' : 'registerVerificationStatus'}
                  role={verificationStatus === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {verificationMessage}
                </p>
              ) : null}
              <button
                className="registerPrimaryButton"
                type="button"
                disabled={verificationStatus === 'sending' || !registeredEmail}
                onClick={() => void sendVerificationEmail(registeredEmail)}
              >
                {verificationStatus === 'sending'
                  ? '正在发送验证邮件…'
                  : verificationStatus === 'sent'
                    ? '重新发送验证邮件'
                    : '发送/重试验证邮件'}
              </button>
              <Link className="registerPrimaryButton" href="/">
                返回 LuckRead
              </Link>
            </div>
          ) : (
            <form aria-busy={status === 'submitting'} className="registerForm" onSubmit={handleSubmit} noValidate>
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
                <span>用户名（注册时确定）</span>
                <input
                  autoComplete="username"
                  maxLength={128}
                  name="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="例如 zhangsan"
                  required
                  spellCheck={false}
                  type="text"
                  value={username}
                />
                <small>用户名会用于你的公开主页地址：luckread.com/@你的用户名</small>
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
                aria-busy={status === 'submitting'}
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
            <Link href="/login">登录</Link>
          </div>
        </div>

        <p className="registerCopyright">© {new Date().getFullYear()} LuckRead</p>
      </section>
    </main>
  )
}
