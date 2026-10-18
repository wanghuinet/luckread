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
        if (response.status === 429) {
          throw new Error('验证邮件请求过于频繁，请稍后再试。')
        }
        if (response.status >= 500) {
          throw new Error('账号已创建，但验证邮件服务暂时不可用。请稍后点击重试。')
        }
        const apiMessage = getApiErrorMessage(payload, '')
        throw new Error(/[\u3400-\u9fff]/.test(apiMessage) ? apiMessage : '验证邮件请求未能处理，请检查邮箱后重试。')
      }

      setVerificationStatus('sent')
      setVerificationMessage('已受理发往 ' + identity + ' 的验证邮件请求。邮件可能需要几分钟到达；若未收到，请检查垃圾邮件或稍后重试。')
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

    if (!normalizedEmail) {
      setStatus('error')
      setMessage('请输入邮箱地址。')
      return
    }

    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setStatus('error')
      setMessage('邮箱格式不正确，请检查后重试。')
      return
    }

    if (!normalizedUsername) {
      setStatus('error')
      setMessage('请输入用户名。')
      return
    }

    if (!/^[A-Za-z0-9]{6,32}$/.test(normalizedUsername)) {
      setStatus('error')
      setMessage('用户名需为 6–32 位英文字母或数字，不能包含空格或特殊字符。')
      return
    }

    const passwordLength = password.length
    if (!password) {
      setStatus('error')
      setMessage('请输入登录密码。')
      return
    }

    if (passwordLength < 15 || passwordLength > 128) {
      setStatus('error')
      setMessage('密码长度必须为 15–128 个字符。建议使用较长且独一无二的密码。')
      return
    }

    if (!confirmPassword) {
      setStatus('error')
      setMessage('请再次输入密码以完成确认。')
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
        const apiError = payload && 'error' in payload ? payload.error : undefined
        const code = typeof apiError?.code === 'string' ? apiError.code.toUpperCase() : ''
        if (code === 'EMAIL_ALREADY_REGISTERED') {
          throw new Error('该邮箱可能已注册，请尝试登录或使用“忘记密码”找回账号。')
        }
        if (code === 'USERNAME_TAKEN' || code === 'USERNAME_ALREADY_EXISTS') {
          throw new Error('该用户名已被使用，请换一个用户名。')
        }
        if (response.status === 429) {
          throw new Error('注册请求过于频繁，请稍等片刻后重试。')
        }
        if (response.status >= 500) {
          throw new Error('注册服务暂时不可用，账号可能尚未创建成功，请稍后重试。')
        }
        const apiMessage = getApiErrorMessage(payload, '')
        throw new Error(/[\u3400-\u9fff]/.test(apiMessage)
          ? apiMessage
          : '注册信息未通过校验，请检查邮箱、用户名和密码格式后重试。')
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
      setMessage(error instanceof TypeError
        ? '网络连接异常，注册请求未完成。请检查网络后重试。'
        : error instanceof Error ? error.message : '注册暂时无法完成，请稍后重试。')
    }
  }

  return (
    <main className="min-h-screen bg-main-background text-light-primary dark:text-dark-primary">
      <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col border-x border-light-border dark:border-dark-border">

        <section className="flex flex-1 flex-col px-4 py-6 sm:px-8" aria-labelledby="register-title">
          <div className="mb-6 flex items-center justify-between">
            <span className="flex items-center gap-2 font-bold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-main-accent font-bold text-white" aria-hidden="true">L</span> LuckRead</span>
            <span className="text-xs text-light-secondary dark:text-dark-secondary"><span aria-hidden="true">✦</span> 安全注册</span>
          </div>

          <div className="w-full">
            <div className="mb-6 grid gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-main-accent">开启你的账号</span>
              <h2 className="text-2xl font-bold tracking-tight" id="register-title">创建账号</h2>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">加入 LuckRead，开始阅读与分享。</p>
            </div>

            {status === 'success' && result ? (
              <div className="grid gap-4 rounded-2xl border border-light-border p-4 dark:border-dark-border" role="status" aria-live="polite">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-accent-green/10 text-xl font-bold text-accent-green" aria-hidden="true">✓</div>
                <h3 className="text-lg font-bold">账号创建成功</h3>
                <p className="text-sm text-light-secondary dark:text-dark-secondary">再完成邮箱验证，就可以继续使用你的账号。</p>
                <div className="flex items-center gap-3 rounded-xl bg-main-sidebar-background p-3">
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-main-background text-main-accent" aria-hidden="true">✉</span>
                  <span className="grid min-w-0 gap-1"><small className="text-xs text-light-secondary dark:text-dark-secondary">验证邮箱</small><strong className="break-all text-sm">{registeredEmail}</strong></span>
                </div>
                {verificationMessage ? (
                  <p
                    className={verificationStatus === 'error' ? 'rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red' : 'text-sm text-light-secondary dark:text-dark-secondary'}
                    role={verificationStatus === 'error' ? 'alert' : 'status'}
                    aria-live="polite"
                  >
                    {verificationMessage}
                  </p>
                ) : null}
                <button
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
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
                <Link className="flex min-h-11 w-full items-center justify-center rounded-full border border-light-border px-4 py-3 text-center font-bold text-main-accent hover:bg-main-accent/10 dark:border-dark-border" href="/login">前往登录</Link>
              </div>
            ) : (
              <form aria-busy={status === 'submitting'} className="grid gap-4" onSubmit={handleSubmit} noValidate>
                <label className="grid gap-2 text-sm font-semibold">
                  <span>邮箱地址</span>
                  <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-60 dark:border-dark-border dark:text-dark-primary"
                    autoComplete="email"
                    inputMode="email"
                    name="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    maxLength={254}
                    required
                    type="email"
                    value={email}
                    aria-label="邮箱地址"
                  />
                </label>

                <label className="grid gap-2 text-sm font-semibold">
                  <span>用户名</span>
                  <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-60 dark:border-dark-border dark:text-dark-primary"
                    autoComplete="username"
                    minLength={6}
                    maxLength={32}
                    name="username"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="设置你的公开用户名"
                    required
                    spellCheck={false}
                    type="text"
                    value={username}
                    aria-label="用户名"
                  />
                  <small>用于你的公开主页：luckread.com/你的用户名。用户名需为 6–32 位英文字母或数字。</small>
                </label>

                <label className="grid gap-2 text-sm font-semibold">
                  <span>设置密码</span>
                  <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-60 dark:border-dark-border dark:text-dark-primary"
                    autoComplete="new-password"
                    name="password"
                    minLength={15}
                    maxLength={128}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请设置 15–128 位密码"
                    type="password"
                    value={password}
                    aria-label="设置密码"
                    aria-describedby="register-password-hint"
                  />
                  <small id="register-password-hint">密码需为 15–128 个字符；可使用长句，不要使用其他网站的旧密码。</small>
                </label>

                <label className="grid gap-2 text-sm font-semibold">
                  <span>确认密码</span>
                  <input className="w-full rounded-xl border border-light-border bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus:border-main-accent focus:ring-2 focus:ring-main-accent/20 disabled:opacity-60 dark:border-dark-border dark:text-dark-primary"
                    autoComplete="new-password"
                    name="confirmPassword"
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="再次输入密码"
                    minLength={15}
                    maxLength={128}
                    required
                    type="password"
                    value={confirmPassword}
                    aria-label="确认密码"
                  />
                </label>

                <label className="flex items-start gap-2 text-sm text-light-secondary dark:text-dark-secondary">
                  <input className="mt-1 h-4 w-4 accent-[#1d9bf0]"
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    type="checkbox"
                  />
                  <span>我已阅读并同意 <Link className="text-main-accent hover:underline" href="/terms" target="_blank">用户协议</Link> 和 <Link className="text-main-accent hover:underline" href="/privacy" target="_blank">隐私政策</Link></span>
                </label>

                {status === 'error' ? (
                  <p className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert">{message}</p>
                ) : null}

                <button
                  aria-busy={status === 'submitting'}
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-main-accent px-4 py-3 font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={status === 'submitting'}
                  type="submit"
                >
                  {status === 'submitting' ? '正在创建账号…' : '创建 LuckRead 账号'}
                  {status !== 'submitting' ? <span aria-hidden="true">→</span> : null}
                </button>
                <p className="text-xs text-light-secondary dark:text-dark-secondary">创建账号即表示你同意遵守 LuckRead 的社区规则。</p>
              </form>
            )}

            <div className="mt-6 flex items-center justify-center gap-2 text-sm text-light-secondary dark:text-dark-secondary">
              <span>已经有账号？</span>
              <Link className="font-bold text-main-accent hover:underline" href="/login">立即登录</Link>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-light-secondary dark:text-dark-secondary">© {new Date().getFullYear()} LuckRead <span>·</span> 让好内容连接彼此</p>
        </section>
      </div>
    </main>
  )
}
