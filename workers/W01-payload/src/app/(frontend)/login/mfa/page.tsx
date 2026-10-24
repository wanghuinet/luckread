'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

type EnableResponse = {
  method?: string
  totpURI?: string
  backupCodes?: string[]
  message?: string
  code?: string
}

function safeReturnTo(): string {
  const requested = new URLSearchParams(window.location.search).get('returnTo')
  return requested && requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/home'
}

export default function MfaSetupPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [totpURI, setTotpURI] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!password) {
      setError('请重新输入当前账号密码以确认身份。')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/auth/two-factor/enable', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, method: 'totp', issuer: 'LuckRead' }),
      })
      const payload = await response.json().catch(() => null) as EnableResponse | null
      if (!response.ok || payload?.method !== 'totp' || typeof payload.totpURI !== 'string' || !Array.isArray(payload.backupCodes)) {
        setError(response.status === 401
          ? '登录会话已失效，请先登录后再配置双重验证。'
          : '无法开始身份验证器配置。若已有已验证的身份验证器，请先走账号安全恢复流程。')
        return
      }
      setTotpURI(payload.totpURI)
      setBackupCodes(payload.backupCodes.filter((value): value is string => typeof value === 'string'))
    } catch {
      setError('网络连接异常，无法开始双重验证配置。')
    } finally {
      setBusy(false)
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) {
      setError('请输入身份验证器当前显示的 6 位数字验证码。')
      return
    }

    setBusy(true)
    try {
      const response = await fetch('/api/auth/two-factor/verify-totp', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code.trim(), trustDevice: false }),
      })
      if (!response.ok) {
        setError(response.status === 401
          ? '验证码无效或已过期，请检查设备时间后重试。'
          : '无法完成身份验证器验证，请重试。')
        return
      }
      // The TOTP plugin replaces the current session as part of successful
      // enrollment. W02 then only resolves L5-L8 for this post-MFA session.
      router.replace(safeReturnTo())
      router.refresh()
    } catch {
      setError('网络连接异常，身份验证器验证未能完成。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-light-line-reply bg-main-background p-6 shadow-sm dark:border-dark-border">
        <h1 className="text-2xl font-bold text-light-primary dark:text-dark-primary">配置双重验证</h1>
        <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
          使用 Google Authenticator、Microsoft Authenticator、1Password 或其他兼容 TOTP 的身份验证器。配置在验证成功前不会生效。
        </p>

        {!totpURI ? (
          <form className="mt-6 grid gap-4" onSubmit={beginEnrollment} aria-busy={busy} noValidate>
            <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
              当前账号密码
              <input
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
                className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary"
              />
            </label>
            <button className="rounded-full bg-main-accent px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? '正在准备…' : '生成身份验证器配置'}
            </button>
          </form>
        ) : (
          <div className="mt-6 grid gap-5">
            <section className="grid gap-2">
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">1. 在验证器中添加 LuckRead</h2>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                扫描二维码的替代方式：在验证器中选择手动输入密钥，或复制下面的 TOTP 配置 URI（如果应用支持）。
              </p>
              <code className="block break-all rounded-lg bg-main-sidebar-background p-3 text-xs text-light-primary dark:text-dark-primary">{totpURI}</code>
            </section>
            <section className="grid gap-2">
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">2. 保存一次性恢复码</h2>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">
                每个恢复码只能使用一次。请保存到密码管理器或其他安全位置；离开此页面后不会再次显示本批恢复码。
              </p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-main-sidebar-background p-3 sm:grid-cols-3">
                {backupCodes.map((backupCode) => <code key={backupCode} className="text-sm text-light-primary dark:text-dark-primary">{backupCode}</code>)}
              </div>
            </section>
            <form className="grid gap-3" onSubmit={verifyEnrollment} aria-busy={busy} noValidate>
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">3. 验证并启用 MFA</h2>
              <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
                身份验证器当前的 6 位验证码
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value)}
                  required
                  value={code}
                  className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary"
                />
              </label>
              <button className="rounded-full bg-main-accent px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={busy}>
                {busy ? '正在验证…' : '验证并启用双重验证'}
              </button>
            </form>
          </div>
        )}

        {error ? <div className="mt-4 rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
        <div className="mt-5 text-sm">
          <Link className="text-main-accent hover:underline" href="/home">返回 LuckRead</Link>
        </div>
      </section>
    </main>
  )
}
