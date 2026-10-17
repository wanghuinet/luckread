'use client'

import Link from 'next/link'
import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

const MIN_PASSWORD_LENGTH = 15
const MAX_PASSWORD_LENGTH = 128

function validLength(value: string): boolean {
  const length = Array.from(value).length
  return length >= MIN_PASSWORD_LENGTH && length <= MAX_PASSWORD_LENGTH
}

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Change password',
      eyebrow: 'ACCOUNT SECURITY',
      description: 'Verify your identity with your current password, then choose a new sign-in password.',
      current: 'Current password',
      next: 'New password',
      confirm: 'Confirm new password',
      hint: 'Password length: 15–128 Unicode characters.',
      submit: 'Update password',
      submitting: 'Updating…',
      back: 'Back to profile',
      invalidLength: 'Passwords must be 15–128 Unicode characters long.',
      mismatch: 'The new passwords do not match.',
      samePassword: 'The new password must be different from your current password.',
      failed: 'Could not change your password. Please try again.',
      success: 'Password changed. This device will remain signed in; other sessions are handled according to authentication policy.',
    }
  : locale === 'tw'
    ? {
        title: '修改密碼',
        eyebrow: '帳戶安全',
        description: '先使用目前密碼驗證身分，再設定新的登入密碼。',
        current: '目前密碼',
        next: '新密碼',
        confirm: '確認新密碼',
        hint: '密碼長度：15–128 個 Unicode 字元。',
        submit: '更新密碼',
        submitting: '更新中…',
        back: '返回個人資料',
        invalidLength: '密碼長度必須為 15–128 個 Unicode 字元。',
        mismatch: '兩次輸入的新密碼不一致。',
        samePassword: '新密碼不能與目前密碼相同。',
        failed: '無法修改密碼，請稍後重試。',
        success: '密碼已修改。目前裝置會保持登入，其他工作階段將依認證政策處理。',
      }
    : {
        title: '修改密码',
        eyebrow: '账户安全',
        description: '使用当前密码验证身份，再设置新的登录密码。',
        current: '当前密码',
        next: '新密码',
        confirm: '确认新密码',
        hint: '密码长度：15–128 个 Unicode 字符。',
        submit: '确认修改',
        submitting: '修改中…',
        back: '返回个人资料',
        invalidLength: '密码长度必须为 15–128 个 Unicode 字符。',
        mismatch: '两次输入的新密码不一致。',
        samePassword: '新密码不能与当前密码相同。',
        failed: '密码修改失败，请稍后重试。',
        success: '密码已修改。当前设备会继续保持登录，其他登录会话由系统按认证规则处理。',
      }

export default function PasswordChangePage() {
  const router = useRouter()
  const locale = usePublicLocale()
  const labels = copy(locale)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setError('')
    setMessage('')

    if (!validLength(currentPassword) || !validLength(newPassword)) {
      setError(labels.invalidLength)
      return
    }

    if (newPassword !== confirmPassword) {
      setError(labels.mismatch)
      return
    }

    if (currentPassword === newPassword) {
      setError(labels.samePassword)
      return
    }

    setBusy(true)
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/auth/password/change', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'password-change-' + crypto.randomUUID(),
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, labels.failed))
      }

      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage(labels.success)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : labels.failed)
    } finally {
      setBusy(false)
    }
  }

  const fieldClass = 'mt-1 block w-full rounded-xl border border-light-border bg-transparent px-3 py-2 text-sm text-light-primary outline-none focus:border-main-accent dark:border-dark-border dark:text-dark-primary'

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="editProfile">
      <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{labels.eyebrow}</p>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{labels.description}</p>
      </section>

      <form aria-busy={busy} onSubmit={submit} className="flex flex-col gap-5 px-4 py-5">
        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>{labels.current}</span>
          <input
            autoComplete="current-password"
            className={fieldClass}
            disabled={busy}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            type="password"
            value={currentPassword}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>{labels.next}</span>
          <input
            autoComplete="new-password"
            className={fieldClass}
            disabled={busy}
            maxLength={MAX_PASSWORD_LENGTH}
            minLength={MIN_PASSWORD_LENGTH}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            type="password"
            value={newPassword}
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          <span>{labels.confirm}</span>
          <input
            autoComplete="new-password"
            className={fieldClass}
            disabled={busy}
            maxLength={MAX_PASSWORD_LENGTH}
            minLength={MIN_PASSWORD_LENGTH}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            type="password"
            value={confirmPassword}
          />
        </label>

        <p className="text-xs text-light-secondary dark:text-dark-secondary">{labels.hint}</p>
        {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}
        {message ? <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">{message}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? labels.submitting : labels.submit}
          </button>
          <Link className="main-tab rounded-full px-4 py-2 text-sm" href="/me/profile">{labels.back}</Link>
        </div>
      </form>
    </TwitterCloneSecondaryPageLayout>
  )
}
