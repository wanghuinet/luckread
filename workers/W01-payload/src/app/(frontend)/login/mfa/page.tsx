'use client'

import { FormEvent, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { fetchJson, jsonHeaders } from '../../../lib/client-api.js'

type EnrollmentStartResponse = {
  data?: { totpUri?: string; recoveryCodes?: string[] }
  error?: { code?: string; message?: string }
}
type EnrollmentConfirmResponse = {
  data?: { enabled?: boolean; verified?: boolean; enrolledAt?: string | null }
  error?: { code?: string; message?: string }
}

export default function MfaSetupPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [totpUri, setTotpUri] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [confirmationKey, setConfirmationKey] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)

  async function beginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (!password.trim()) {
      setError('请重新输入当前账号密码以确认身份。')
      return
    }

    setBusy(true)
    try {
      const { response, data: payload } = await fetchJson<EnrollmentStartResponse>('/api/v1/auth/mfa/enrollment', {
        method: 'POST',
        credentials: 'include',
        headers: jsonHeaders({ 'Idempotency-Key': 'mfa-enrollment:' + crypto.randomUUID() }),
        body: JSON.stringify({ currentPassword: password }),
      })
      const data = payload?.data
      if (!response.ok || typeof data?.totpUri !== 'string' ||
          !data.totpUri.startsWith('otpauth://totp/') ||
          !Array.isArray(data.recoveryCodes) || data.recoveryCodes.length < 1) {
        if (response.status === 401) {
          setError('登录会话已失效，请重新登录后再配置双重验证。')
        } else if (response.status === 409) {
          setError('MFA 已启用或有待完成的配置，不能重复生成新的密钥。请先检查账号安全状态。')
        } else if (response.status === 429) {
          setError('请求过于频繁，请稍后重试。')
        } else {
          setError('无法开始身份验证器配置，请稍后重试。')
        }
        return
      }
      setTotpUri(data.totpUri)
      setRecoveryCodes(data.recoveryCodes.filter((value): value is string => typeof value === 'string'))
    } catch {
      setError('网络连接异常，无法开始双重验证配置。')
    } finally {
      setBusy(false)
    }
  }

  async function verifyEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    const normalizedCode = code.trim()
    if (!/^\d{6}$/.test(normalizedCode)) {
      setError('请输入身份验证器当前显示的 6 位数字验证码。')
      return
    }

    setBusy(true)
    const key = confirmationKey || ('mfa-confirm:' + crypto.randomUUID())
    setConfirmationKey(key)
    try {
      const { response, data: payload } = await fetchJson<EnrollmentConfirmResponse>('/api/v1/auth/mfa/enrollment/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: jsonHeaders({ 'Idempotency-Key': key }),
        body: JSON.stringify({ code: normalizedCode }),
      })
      if (!response.ok || payload?.data?.enabled !== true ||
          payload.data.verified !== true || !payload.data.enrolledAt) {
        if (response.status === 401) {
          setError('验证码无效或已过期，请检查设备时间后重试。')
        } else if (response.status === 409) {
          setError('配置已失效或验证码请求发生冲突，请重新登录并检查 MFA 状态。')
        } else if (response.status === 429) {
          setError('验证码尝试次数过多，请稍后重试。')
        } else {
          setError('无法完成身份验证器验证，请重试。')
        }
        return
      }
      setEnabled(true)
      setCode('')
      setRecoveryCodes([])
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
          使用兼容 TOTP 的身份验证器。只有成功验证后，MFA 才会启用；恢复码只在本次配置中显示，不会保存到浏览器持久存储。
        </p>
        {enabled ? (
          <div className="mt-6 grid gap-4">
            <p className="rounded-xl bg-main-sidebar-background p-3 text-sm text-light-primary dark:text-dark-primary" role="status">
              MFA 已启用。为避免旧会话继续持有权限，系统已按 W02 的会话生命周期规则处理当前会话。
            </p>
            <Link className="text-main-accent hover:underline" href="/home">返回首页</Link>
          </div>
        ) : !totpUri ? (
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
            {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
            <button className="rounded-full bg-main-accent px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={busy}>
              {busy ? '正在准备…' : '生成身份验证器配置'}
            </button>
          </form>
        ) : (
          <div className="mt-6 grid gap-5">
            <section className="grid gap-2">
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">1. 在验证器中添加 LuckRead</h2>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">可扫描二维码（如验证器支持），或将下面的 TOTP URI 导入兼容的身份验证器。请勿分享此 URI。</p>
              <code className="block break-all rounded-lg bg-main-sidebar-background p-3 text-xs text-light-primary dark:text-dark-primary">{totpUri}</code>
            </section>
            <section className="grid gap-2">
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">2. 保存一次性恢复码</h2>
              <p className="text-sm text-light-secondary dark:text-dark-secondary">每个恢复码只能使用一次。请安全保存；离开此页面后不会再次显示本批恢复码。</p>
              <div className="grid grid-cols-2 gap-2 rounded-lg bg-main-sidebar-background p-3 sm:grid-cols-3">
                {recoveryCodes.map((value) => <code key={value} className="text-sm text-light-primary dark:text-dark-primary">{value}</code>)}
              </div>
            </section>
            <form className="grid gap-3" onSubmit={verifyEnrollment} aria-busy={busy} noValidate>
              <h2 className="text-base font-bold text-light-primary dark:text-dark-primary">3. 验证并启用 MFA</h2>
              <label className="grid gap-2 text-sm font-semibold text-light-primary dark:text-dark-primary">
                身份验证器当前的 6 位验证码
                <input
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  onChange={(event) => { setCode(event.target.value); setConfirmationKey('') }}
                  required
                  type="text"
                  value={code}
                  maxLength={6}
                  className="w-full rounded-md border border-light-line-reply bg-main-background px-3 py-3 text-base text-light-primary outline-none transition focus-visible:ring-2 focus-visible:ring-main-accent/80 dark:border-dark-border dark:text-dark-primary"
                />
              </label>
              {error ? <div className="rounded-xl border border-accent-red/20 bg-accent-red/10 p-3 text-sm text-accent-red" role="alert" aria-live="assertive">{error}</div> : null}
              <button className="rounded-full bg-main-accent px-4 py-3 font-bold text-white disabled:opacity-60" type="submit" disabled={busy}>
                {busy ? '正在验证…' : '验证并启用 MFA'}
              </button>
            </form>
          </div>
        )}
      </section>
    </main>
  )
}
