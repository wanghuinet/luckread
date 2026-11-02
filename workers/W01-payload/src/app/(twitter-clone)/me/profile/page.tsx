'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../../(frontend)/i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../../(frontend)/i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

type Profile = {
  id: string
  email: string
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
  locale: string | null
  timezone: string | null
}

const fields: Array<keyof Omit<Profile, 'id' | 'email' | 'username'>> = [
  'displayName',
  'bio',
  'avatar',
  'locale',
  'timezone',
]

const pageCopy = (locale: PublicLocale) => ({
  title: locale === 'en' ? 'Edit profile' : locale === 'tw' ? '編輯個人資料' : '编辑个人资料',
  description: locale === 'en'
    ? 'Update your public creator profile and regional settings.'
    : locale === 'tw'
      ? '更新你的公開創作者資料與地區設定。'
      : '更新你的公开创作者资料与地区设置。',
  eyebrow: locale === 'en' ? 'ACCOUNT PROFILE' : locale === 'tw' ? '帳戶資料' : '账户资料',
  loading: locale === 'en' ? 'Loading profile…' : locale === 'tw' ? '正在載入個人資料…' : '正在加载个人资料…',
  email: locale === 'en' ? 'Sign-in email' : locale === 'tw' ? '登入郵箱' : '登录邮箱',
  username: locale === 'en' ? 'Username' : locale === 'tw' ? '使用者名稱' : '用户名',
  usernameCooldown: (date: string) => locale === 'en' ? 'You can change your username again after ' + date : locale === 'tw' ? '下次可更改時間：' + date : '下次可修改时间：' + date,
  usernameSave: locale === 'en' ? 'Change username' : locale === 'tw' ? '更改使用者名稱' : '修改用户名',
  usernameSaving: locale === 'en' ? 'Changing…' : locale === 'tw' ? '更改中…' : '修改中…',
  usernameHelp: locale === 'en' ? 'Username changes are limited to once every 30 days. Your previous username is released after 30 days.' : locale === 'tw' ? '每 30 天只能更改一次使用者名稱，舊名稱會在 30 天後釋出。' : '用户名每 30 天只能修改一次，旧用户名将在 30 天后释放。',
  displayName: locale === 'en' ? 'Display name' : locale === 'tw' ? '顯示名稱' : '显示名称',
  bio: locale === 'en' ? 'Bio' : locale === 'tw' ? '個人簡介' : '个人简介',
  avatar: locale === 'en' ? 'Avatar URL' : locale === 'tw' ? '頭像網址' : '头像地址',
  avatarHint: locale === 'en' ? 'After upload, save the profile to apply the change.' : locale === 'tw' ? '上傳後仍需點擊「保存資料」。' : '上传后仍需点击“保存资料”。',
  uploadAvatar: locale === 'en' ? 'Upload avatar image' : locale === 'tw' ? '上傳頭像圖片' : '上传头像图片',
  locale: locale === 'en' ? 'Language' : locale === 'tw' ? '語言' : '语言',
  timezone: locale === 'en' ? 'Time zone' : locale === 'tw' ? '時區' : '时区',
  save: locale === 'en' ? 'Save profile' : locale === 'tw' ? '保存資料' : '保存资料',
  saving: locale === 'en' ? 'Saving…' : locale === 'tw' ? '儲存中…' : '保存中…',
  saved: locale === 'en' ? 'Saved' : locale === 'tw' ? '已保存' : '已保存',
  loggingOut: locale === 'en' ? 'Signing out…' : locale === 'tw' ? '正在登出…' : '正在退出…',
  logout: locale === 'en' ? 'Sign out' : locale === 'tw' ? '登出' : '退出登录',
  backCreator: locale === 'en' ? 'Back to Creator Studio' : locale === 'tw' ? '返回創作者中心' : '返回创作者中心',
  followers: locale === 'en' ? 'Followers' : locale === 'tw' ? '粉絲' : '我的粉丝',
  following: locale === 'en' ? 'Following' : locale === 'tw' ? '追蹤中' : '我的关注',
  blocked: locale === 'en' ? 'Blocked accounts' : locale === 'tw' ? '已封鎖的帳號' : '已屏蔽的账号',
  muted: locale === 'en' ? 'Muted accounts' : locale === 'tw' ? '已靜音的帳號' : '已静音的账号',
  notificationPreferences: locale === 'en' ? 'Notification preferences' : locale === 'tw' ? '通知偏好設定' : '通知偏好设置',
  subscriptions: locale === 'en' ? 'Subscriptions' : locale === 'tw' ? '訂閱' : '我的订阅',
  sessions: locale === 'en' ? 'Devices & sessions' : locale === 'tw' ? '登入裝置' : '登录设备',
  password: locale === 'en' ? 'Change password' : locale === 'tw' ? '修改密碼' : '修改密码',
  creatorApplication: locale === 'en' ? 'Creator qualification' : locale === 'tw' ? '創作者資格' : '创作者资格',
  creatorCenter: locale === 'en' ? 'Creator Studio' : locale === 'tw' ? '創作者中心' : '创作者中心',
})

export default function ProfilePage() {
  const router = useRouter()
  const locale = usePublicLocale()
  const copy = pageCopy(locale)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [usernameDraft, setUsernameDraft] = useState('')
  const [usernameEtag, setUsernameEtag] = useState('')
  const [usernameCanChangeAt, setUsernameCanChangeAt] = useState<string | null>(null)
  const [usernameSaving, setUsernameSaving] = useState(false)
  const [usernameIdempotencyKey, setUsernameIdempotencyKey] = useState('')
  const [etag, setEtag] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { response, data } = await fetchJson<Profile & { error?: { message?: string } }>('/api/v1/users/me', {
          credentials: 'include',
          headers: { accept: 'application/json' },
        })
        if (response.status === 401) {
          const returnTo = window.location.pathname + window.location.search + window.location.hash
          router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        if (!response.ok || !data?.id) {
          throw new Error(getApiErrorMessage(data, '个人资料加载失败'))
        }
        const usernameResult = await fetchJson<{ data?: { username?: string; canChangeAt?: string | null }; error?: { message?: string } }>('/api/v1/users/me/username', {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (usernameResult.response.status === 401) {
          const returnTo = window.location.pathname + window.location.search + window.location.hash
          router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        if (!usernameResult.response.ok || typeof usernameResult.data?.data?.username !== 'string') {
          throw new Error(getApiErrorMessage(usernameResult.data, '用户名状态加载失败'))
        }
        if (cancelled) return
        const effectiveProfile = { ...(data as Profile), username: usernameResult.data.data.username }
        setProfile(effectiveProfile)
        setUsernameDraft(effectiveProfile.username)
        setUsernameEtag(usernameResult.response.headers.get('ETag') ?? '')
        setUsernameCanChangeAt(typeof usernameResult.data.data.canChangeAt === 'string' ? usernameResult.data.data.canChangeAt : null)
        setEtag(response.headers.get('ETag') ?? '')
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : '个人资料加载失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => { cancelled = true }
  }, [router])

  function updateField(field: keyof Profile, value: string) {
    setProfile((current) => current ? { ...current, [field]: value } : current)
  }

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    setError('')
    try {
      const { response } = await fetchJson('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      })
      if (!response.ok && response.status !== 401) {
        throw new Error('LOGOUT_FAILED')
      }
      window.location.assign('/')
    } catch {
      setError('退出登录失败，请稍后重试。')
      setLoggingOut(false)
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('头像必须是图片文件。')
      return
    }

    setMessage('正在上传头像…')
    setError('')
    try {
      const form = new FormData()
      form.append('_payload', JSON.stringify({ alt: file.name }))
      form.append('file', file)
      const { response, data } = await fetchJson<{ doc?: { url?: string }; url?: string; error?: { message?: string } }>('/api/v1/media', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Idempotency-Key': 'media-upload:' + crypto.randomUUID() },
        body: form,
      })
      const url = data?.doc?.url ?? data?.url
      if (!response.ok || typeof url !== 'string' || !url) {
        throw new Error(getApiErrorMessage(data, 'AVATAR_UPLOAD_FAILED'))
      }
      setProfile((current) => current ? { ...current, avatar: url } : current)
      setMessage('头像已上传，请保存资料以正式更新。')
    } catch (cause) {
      setMessage('')
      setError(cause instanceof Error ? cause.message : '头像上传失败，请稍后重试。')
    }
  }

  async function saveUsername() {
    if (!profile || !usernameEtag || usernameSaving) return
    const username = usernameDraft.trim()
    if (!/^[A-Za-z0-9]{6,32}$/.test(username)) {
      setError('用户名必须为 6–32 位英文字母或数字。')
      return
    }
    setUsernameSaving(true)
    setError('')
    setMessage('')
    const idempotencyKey = usernameIdempotencyKey || 'username-change:' + crypto.randomUUID()
    setUsernameIdempotencyKey(idempotencyKey)
    try {
      const { response, data } = await fetchJson<{ data?: { username?: string; canChangeAt?: string | null }; error?: { message?: string; code?: string } }>('/api/v1/users/me/username', {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': usernameEtag,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ username }),
      })
      if (response.status === 412) throw new Error('用户名状态已更新，请刷新后重试。')
      const savedUsername = data?.data?.username
      if (!response.ok || typeof savedUsername !== 'string') {
        throw new Error(getApiErrorMessage(data, '用户名修改失败'))
      }
      setUsernameDraft(savedUsername)
      setUsernameEtag(response.headers.get('ETag') ?? usernameEtag)
      setUsernameCanChangeAt(typeof data?.data?.canChangeAt === 'string' ? data.data.canChangeAt : null)
      setUsernameIdempotencyKey('')
      setProfile((current) => current ? { ...current, username: savedUsername } : current)
      // The profile ETag includes username. Refresh only the ETag while preserving
      // any unsaved edits in the other profile fields.
      const refreshed = await fetchJson<Profile>('/api/v1/users/me', {
        credentials: 'include', cache: 'no-store', headers: { accept: 'application/json' },
      })
      if (refreshed.response.ok && refreshed.data?.id) setEtag(refreshed.response.headers.get('ETag') ?? etag)
      setMessage(copy.saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '用户名修改失败')
    } finally {
      setUsernameSaving(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!profile || !etag) return

    setSaving(true)
    setMessage('')
    setError('')

    const payload = Object.fromEntries(
      fields.map((field) => [field, profile[field] ?? null]),
    )

    try {
      const { response, data } = await fetchJson<Profile & { error?: { message?: string } }>('/api/v1/users/me', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'If-Match': etag,
        },
        body: JSON.stringify(payload),
      })
      if (response.status === 412) {
        throw new Error('个人资料已被其他页面修改，请刷新后再保存。')
      }
      if (!response.ok || !data?.id) {
        throw new Error(getApiErrorMessage(data, '个人资料保存失败'))
      }
      setProfile(data as Profile)
      setEtag(response.headers.get('ETag') ?? etag)
      setMessage(copy.saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '个人资料保存失败')
    } finally {
      setSaving(false)
    }
  }

  const fieldClass = 'mt-1 block w-full rounded-xl border border-light-border bg-transparent px-3 py-2 text-sm text-light-primary outline-none focus:border-main-accent dark:border-dark-border dark:text-dark-primary'
  const actionClass = 'rounded-full border border-light-border px-4 py-2 text-sm font-bold transition hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10'

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={copy.title} active="editProfile">
      <section className="border-b border-light-border px-4 py-4 dark:border-dark-border">
        <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{copy.eyebrow}</p>
        <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{copy.description}</p>
        <nav className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="账户与创作者设置">
          <Link className="main-tab rounded-md py-1" href="/me/followers">{copy.followers}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/following">{copy.following}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/blocked">{copy.blocked}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/muted">{copy.muted}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/notification-preferences">{copy.notificationPreferences}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/subscriptions">{copy.subscriptions}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/sessions">{copy.sessions}</Link>
          <Link className="main-tab rounded-md py-1" href="/me/password">{copy.password}</Link>
          <Link className="main-tab rounded-md py-1" href="/creator-application">{copy.creatorApplication}</Link>
          <Link className="main-tab rounded-md py-1" href="/creator-center">{copy.creatorCenter}</Link>
        </nav>
      </section>

      {loading ? <p className="px-4 py-4 text-sm text-light-secondary dark:text-dark-secondary" role="status">{copy.loading}</p> : null}
      {!loading && error && !profile ? <p className="px-4 py-4 text-sm text-red-500" role="alert">{error}</p> : null}

      {profile ? (
        <form onSubmit={save} className="flex flex-col gap-5 px-4 py-5">
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>{copy.email}</span>
            <input className={fieldClass + ' opacity-60'} value={profile.email} disabled />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>{copy.username}</span>
            <input className={fieldClass} value={usernameDraft} onChange={(event) => { setUsernameDraft(event.target.value); setUsernameIdempotencyKey('') }} maxLength={32} minLength={6} required />
            <small className="text-xs font-normal text-light-secondary dark:text-dark-secondary">{copy.usernameHelp}</small>
            {usernameCanChangeAt ? <small className="text-xs font-normal text-light-secondary dark:text-dark-secondary">{copy.usernameCooldown(new Date(usernameCanChangeAt).toLocaleString(locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'))}</small> : null}
            <button className={actionClass + ' self-start'} disabled={saving || usernameSaving || loggingOut || !usernameEtag || usernameDraft.trim() === profile.username} onClick={() => void saveUsername()} type="button">
              {usernameSaving ? copy.usernameSaving : copy.usernameSave}
            </button>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>{copy.displayName}</span>
            <input className={fieldClass} value={profile.displayName ?? ''} onChange={(event) => updateField('displayName', event.target.value)} maxLength={256} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>{copy.bio}</span>
            <textarea className={fieldClass} value={profile.bio ?? ''} onChange={(event) => updateField('bio', event.target.value)} maxLength={2000} rows={6} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>{copy.avatar}</span>
            <input className={fieldClass} type="url" value={profile.avatar ?? ''} onChange={(event) => updateField('avatar', event.target.value)} maxLength={2048} />
            <span className="mt-2 flex flex-wrap items-center gap-3 text-sm font-normal text-light-secondary dark:text-dark-secondary">
              <input accept="image/*" aria-label={copy.uploadAvatar} disabled={saving || loggingOut} onChange={uploadAvatar} type="file" />
              <small>{copy.avatarHint}</small>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-medium">
              <span>{copy.locale}</span>
              <input className={fieldClass} value={profile.locale ?? ''} onChange={(event) => updateField('locale', event.target.value)} maxLength={64} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              <span>{copy.timezone}</span>
              <input className={fieldClass} value={profile.timezone ?? ''} onChange={(event) => updateField('timezone', event.target.value)} maxLength={128} />
            </label>
          </div>

          {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}
          {message ? <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">{message}</p> : null}

          <div className="flex flex-wrap gap-3 border-t border-light-border pt-4 dark:border-dark-border">
            <button className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || loggingOut} type="submit">
              {saving ? copy.saving : copy.save}
            </button>
            <button className={actionClass} disabled={saving || loggingOut} onClick={() => router.push('/creator-center')} type="button">
              {copy.backCreator}
            </button>
            <button className={actionClass} disabled={saving || loggingOut} onClick={() => void logout()} type="button">
              {loggingOut ? copy.loggingOut : copy.logout}
            </button>
          </div>
        </form>
      ) : null}
    </TwitterCloneSecondaryPageLayout>
  )
}
