'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../../(frontend)/i18n/PublicLanguageToggle'
import TwitterCloneSecondaryPageLayout from '../../TwitterCloneSecondaryPageLayout'

type NotificationPreferences = {
  follow: boolean
  like: boolean
  comment: boolean
  mention: boolean
}

type PreferencesResponse = {
  data?: Partial<NotificationPreferences>
  error?: { code?: string; message?: string }
}

const preferenceKeys: Array<keyof NotificationPreferences> = ['follow', 'like', 'comment', 'mention']

export default function NotificationPreferencesPage() {
  const router = useRouter()
  const locale = usePublicLocale()
  const copy = locale === 'en' ? {
    title: 'Notification preferences',
    eyebrow: 'YOUR NOTIFICATIONS',
    description: 'Choose which social activity can notify you. Changes are saved to your LuckRead account.',
    follow: 'New followers',
    followDescription: 'Notify me when someone follows my account.',
    like: 'Likes',
    likeDescription: 'Notify me when someone likes my content.',
    comment: 'Comments',
    commentDescription: 'Notify me when someone comments on my content.',
    mention: 'Mentions',
    mentionDescription: 'Notify me when someone mentions me.',
    loading: 'Loading notification preferences…',
    loadError: 'Notification preferences could not be loaded. Please try again.',
    saveError: 'Notification preferences could not be saved. Please try again.',
    save: 'Save preferences',
    saving: 'Saving…',
    saved: 'Notification preferences saved.',
    retry: 'Try again',
    loginMessage: 'Sign in to manage notification preferences.',
    login: 'Sign in',
    back: 'Account settings',
  } : locale === 'tw' ? {
    title: '通知偏好設定',
    eyebrow: '你的通知',
    description: '選擇哪些社交活動可以通知你。更改會保存到你的 LuckRead 帳戶。',
    follow: '新增追蹤者',
    followDescription: '有人追蹤你的帳戶時通知我。',
    like: '按讚',
    likeDescription: '有人喜歡你的內容時通知我。',
    comment: '留言',
    commentDescription: '有人評論你的內容時通知我。',
    mention: '提及',
    mentionDescription: '有人提及我時通知我。',
    loading: '正在載入通知偏好設定…',
    loadError: '無法載入通知偏好設定，請重試。',
    saveError: '無法保存通知偏好設定，請重試。',
    save: '保存偏好設定',
    saving: '正在保存…',
    saved: '通知偏好設定已保存。',
    retry: '重試',
    loginMessage: '登入後即可管理通知偏好設定。',
    login: '登入',
    back: '帳戶設定',
  } : {
    title: '通知偏好设置',
    eyebrow: '你的通知',
    description: '选择哪些社交活动可以通知你。更改会保存到你的 LuckRead 账户。',
    follow: '新增关注者',
    followDescription: '有人关注你的账号时通知我。',
    like: '收到点赞',
    likeDescription: '有人点赞我的内容时通知我。',
    comment: '收到评论',
    commentDescription: '有人评论我的内容时通知我。',
    mention: '提及我',
    mentionDescription: '有人提及我时通知我。',
    loading: '正在加载通知偏好设置…',
    loadError: '通知偏好设置加载失败，请重试。',
    saveError: '通知偏好设置保存失败，请重试。',
    save: '保存偏好设置',
    saving: '正在保存…',
    saved: '通知偏好设置已保存。',
    retry: '重新加载',
    loginMessage: '登录后即可管理通知偏好设置。',
    login: '登录',
    back: '账户设置',
  }
  const loadError = copy.loadError
  const loginMessage = copy.loginMessage
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reloadVersion, setReloadVersion] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function loadPreferences() {
      setLoading(true)
      setError('')
      setMessage('')
      try {
        const { response, data } = await fetchJson<PreferencesResponse>('/api/v1/notification-preferences', {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        })
        if (response.status === 401) {
          const returnTo = window.location.pathname + window.location.search + window.location.hash
          setError(loginMessage)
          router.replace('/login?returnTo=' + encodeURIComponent(returnTo))
          return
        }
        if (!response.ok || !data?.data || preferenceKeys.some((key) => typeof data.data?.[key] !== 'boolean')) {
          throw new Error(getApiErrorMessage(data, loadError))
        }
        if (cancelled) return
        setPreferences({
          follow: data.data.follow as boolean,
          like: data.data.like as boolean,
          comment: data.data.comment as boolean,
          mention: data.data.mention as boolean,
        })
      } catch (cause) {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : loadError)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadPreferences()
    return () => { cancelled = true }
  }, [router, reloadVersion, loadError, loginMessage])

  async function savePreferences() {
    if (!preferences || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { response, data } = await fetchJson<PreferencesResponse>('/api/v1/notification-preferences', {
        method: 'PATCH',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(preferences),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data || preferenceKeys.some((key) => typeof data.data?.[key] !== 'boolean')) {
        throw new Error(getApiErrorMessage(data, copy.saveError))
      }
      setPreferences({
        follow: data.data.follow as boolean,
        like: data.data.like as boolean,
        comment: data.data.comment as boolean,
        mention: data.data.mention as boolean,
      })
      setMessage(copy.saved)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.saveError)
    } finally {
      setSaving(false)
    }
  }

  const options: Array<{ key: keyof NotificationPreferences; title: string; description: string }> = [
    { key: 'follow', title: copy.follow, description: copy.followDescription },
    { key: 'like', title: copy.like, description: copy.likeDescription },
    { key: 'comment', title: copy.comment, description: copy.commentDescription },
    { key: 'mention', title: copy.mention, description: copy.mentionDescription },
  ]

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={copy.title} active="none">
      <section aria-busy={loading || saving} className="flex flex-col">
        <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{copy.eyebrow}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{copy.description}</p>
          <Link className="main-tab mt-3 inline-flex rounded-md py-1 text-sm" href="/me/profile">{copy.back}</Link>
        </header>

        {loading ? <p className="px-4 py-5 text-sm text-light-secondary dark:text-dark-secondary" role="status">{copy.loading}</p> : null}

        {!loading && error ? (
          <div className="flex flex-col items-start gap-3 px-4 py-8" role="alert">
            <p className="text-sm text-red-500">{error}</p>
            <button className="rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" onClick={() => setReloadVersion((value) => value + 1)} type="button">
              {copy.retry}
            </button>
            {error === copy.loginMessage ? (
              <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white" href={'/login?returnTo=' + encodeURIComponent('/me/notification-preferences')}>{copy.login}</Link>
            ) : null}
          </div>
        ) : null}

        {!loading && !error && preferences ? (
          <>
            <div>
              {options.map((option) => (
                <label className="flex cursor-pointer items-start gap-3 border-b border-light-border px-4 py-4 dark:border-dark-border" key={option.key}>
                  <input
                    checked={preferences[option.key]}
                    className="mt-1 h-4 w-4 shrink-0 accent-main-accent"
                    disabled={saving}
                    onChange={(event) => {
                      setMessage('')
                      setPreferences((current) => current ? { ...current, [option.key]: event.target.checked } : current)
                    }}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{option.title}</span>
                    <span className="mt-1 block text-sm leading-5 text-light-secondary dark:text-dark-secondary">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-col gap-3 px-4 py-4">
              {error ? <p className="text-sm text-red-500" role="alert">{error}</p> : null}
              {message ? <p className="text-sm text-light-secondary dark:text-dark-secondary" role="status">{message}</p> : null}
              <button className="self-start rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-50" disabled={saving || loading} onClick={() => void savePreferences()} type="button">
                {saving ? copy.saving : copy.save}
              </button>
            </div>
          </>
        ) : null}
      </section>
    </TwitterCloneSecondaryPageLayout>
  )
}
