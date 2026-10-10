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

    const passwordLength = Array.from(password).length
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
    <main className="registerPage">
      <div className="registerLayout">
        <section className="registerStory" aria-label="关于 LuckRead">
          <Link className="registerBrand" href="/" aria-label="LuckRead 首页">
            <span className="registerMark" aria-hidden="true">L</span>
            <span className="registerBrandName">LuckRead</span>
          </Link>

          <div className="registerStoryContent">
            <span className="registerEyebrow">
              <span className="registerEyebrowDot" aria-hidden="true" />
              READ · CREATE · CONNECT
            </span>
            <h1>让每一次阅读，<br />连接更大的世界。</h1>
            <p className="registerStoryLead">
              发现值得阅读的内容，关注喜欢的创作者，也让你的想法被更多人看见。
            </p>

            <div className="registerHighlights">
              <div className="registerHighlight">
                <span className="registerHighlightIcon" aria-hidden="true">↗</span>
                <span><strong>发现新内容</strong><small>探索文章、动态与短视频</small></span>
              </div>
              <div className="registerHighlight">
                <span className="registerHighlightIcon" aria-hidden="true">◎</span>
                <span><strong>建立个人主页</strong><small>用自己的方式表达与分享</small></span>
              </div>
              <div className="registerHighlight">
                <span className="registerHighlightIcon" aria-hidden="true">⌁</span>
                <span><strong>连接感兴趣的人</strong><small>关注创作者，加入兴趣交流</small></span>
              </div>
            </div>
          </div>

          <p className="registerStoryFoot">一个账号，开启你的 LuckRead 旅程。</p>
          <div className="registerOrb registerOrbOne" aria-hidden="true" />
          <div className="registerOrb registerOrbTwo" aria-hidden="true" />
        </section>

        <section className="registerPanel" aria-labelledby="register-title">
          <div className="registerPanelTop">
            <span className="registerMobileBrand"><span className="registerMark" aria-hidden="true">L</span> LuckRead</span>
            <span className="registerSecure"><span aria-hidden="true">✦</span> 安全注册</span>
          </div>

          <div className="registerCard">
            <div className="registerIntro">
              <span className="registerStep">开启你的账号</span>
              <h2 id="register-title">创建账号</h2>
              <p>加入 LuckRead，开始阅读与分享。</p>
            </div>

            {status === 'success' && result ? (
              <div className="registerSuccess" role="status" aria-live="polite">
                <div className="successIcon" aria-hidden="true">✓</div>
                <h3>账号创建成功</h3>
                <p className="registerSuccessLead">再完成邮箱验证，就可以继续使用你的账号。</p>
                <div className="registerEmailSummary">
                  <span className="registerEmailIcon" aria-hidden="true">✉</span>
                  <span><small>验证邮箱</small><strong>{registeredEmail}</strong></span>
                </div>
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
                <Link className="registerSecondaryButton" href="/login">前往登录</Link>
              </div>
            ) : (
              <form aria-busy={status === 'submitting'} className="registerForm" onSubmit={handleSubmit} noValidate>
                <label className="registerField">
                  <span>邮箱地址</span>
                  <input
                    autoComplete="email"
                    inputMode="email"
                    name="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="name@example.com"
                    type="email"
                    value={email}
                    aria-label="邮箱地址"
                  />
                </label>

                <label className="registerField">
                  <span>用户名</span>
                  <input
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

                <label className="registerField">
                  <span>设置密码</span>
                  <input
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

                <label className="registerField">
                  <span>确认密码</span>
                  <input
                    autoComplete="new-password"
                    name="confirmPassword"
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    placeholder="再次输入密码"
                    type="password"
                    value={confirmPassword}
                    aria-label="确认密码"
                  />
                </label>

                <label className="registerConsent">
                  <input
                    checked={consent}
                    onChange={(event) => setConsent(event.target.checked)}
                    type="checkbox"
                  />
                  <span>我已阅读并同意 <Link href="/terms" target="_blank">用户协议</Link> 和 <Link href="/privacy" target="_blank">隐私政策</Link></span>
                </label>

                {status === 'error' ? (
                  <p className="registerError" role="alert">{message}</p>
                ) : null}

                <button
                  aria-busy={status === 'submitting'}
                  className="registerPrimaryButton"
                  disabled={status === 'submitting'}
                  type="submit"
                >
                  {status === 'submitting' ? '正在创建账号…' : '创建 LuckRead 账号'}
                  {status !== 'submitting' ? <span aria-hidden="true">→</span> : null}
                </button>
                <p className="registerTermsHint">创建账号即表示你同意遵守 LuckRead 的社区规则。</p>
              </form>
            )}

            <div className="registerFooter">
              <span>已经有账号？</span>
              <Link href="/login">立即登录</Link>
            </div>
          </div>

          <p className="registerCopyright">© {new Date().getFullYear()} LuckRead <span>·</span> 让好内容连接彼此</p>
        </section>
      </div>
    </main>
  )
}
