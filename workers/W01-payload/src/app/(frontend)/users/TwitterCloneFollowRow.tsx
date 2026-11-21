'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { getCachedPublicProfile, type PublicProfile } from '../../../lib/social-post-profile-cache.js'

type Props = {
  userId: string
  followedAt: string
  dateLabel?: string
  action?: ReactNode
  presentation?: 'legacy' | 'x-timeline'
  locale?: 'zh' | 'en' | 'tw'
}

const formatDate = (value: string, locale: 'zh' | 'en' | 'tw' = 'zh'): string => {
  const date = new Date(value)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString(dateLocale, { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Presentation-only adaptation of ccrsxx/twitter-clone's UserCard/UserCards.
 * Relationship facts and mutations stay with the existing W05-backed pages.
 * Public labels and avatars are resolved through W01's existing public-profile
 * endpoint/cache; both layouts reuse the reference's Tailwind utility classes.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, dateLabel, action, presentation = 'legacy', locale = 'zh' }: Props) {
  const [loadedProfile, setLoadedProfile] = useState<{ userId: string; profile: PublicProfile } | null>(null)
  const profile = loadedProfile?.userId === userId ? loadedProfile.profile : null

  useEffect(() => {
    let cancelled = false

    void getCachedPublicProfile(userId).then((value) => {
      if (!cancelled) setLoadedProfile({ userId, profile: value })
    }).catch(() => {
      // Relationship management remains usable with the ID fallback on lookup failure.
    })

    return () => { cancelled = true }
  }, [userId])

  const profileHref = '/users/' + encodeURIComponent(userId)
  const profileName = profile?.displayName?.trim()
  const username = profile?.username?.trim()
  const visibleName = profileName || (username ? '@' + username : null)
  const fallbackName = locale === 'en' ? 'User ' + userId : locale === 'tw' ? '使用者 ' + userId : '用户 ' + userId
  const initial = (profileName || username || userId.trim()).slice(0, 1).toUpperCase() || 'L'
  const xCopy = locale === 'en'
    ? { user: 'User', since: 'Relationship since', profile: 'View profile' }
    : locale === 'tw'
      ? { user: '使用者', since: '關係建立於', profile: '查看個人主頁' }
      : { user: '用户', since: '关系建立于', profile: '查看主页' }
  const avatar = profile?.avatar?.trim()
    ? <img alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" height={48} loading="lazy" src={profile.avatar} width={48} />
    : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-base font-bold" aria-hidden="true">{initial}</span>

  if (presentation === 'x-timeline') {
    return (
      <article className="flex flex-col gap-3 border-b border-light-border px-4 py-4 sm:flex-row sm:items-center sm:gap-4 dark:border-dark-border">
        {avatar}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold">{visibleName || fallbackName}</h3>
          {profileName && username ? <p className="mt-0.5 truncate text-sm text-light-secondary dark:text-dark-secondary">@{username}</p> : null}
          <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">{dateLabel ?? xCopy.since} {formatDate(followedAt, locale)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref}>{xCopy.profile}</Link>
          {action}
        </div>
      </article>
    )
  }

  return (
    <article className="flex min-w-0 items-center gap-4 border-b border-light-border px-4 py-4 dark:border-dark-border">
      {avatar}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold">{visibleName || fallbackName}</h3>
        {profileName && username ? <p className="mt-0.5 truncate text-sm text-light-secondary dark:text-dark-secondary">@{username}</p> : null}
        <time className="mt-1 block text-sm text-light-secondary dark:text-dark-secondary" dateTime={followedAt}>
          {dateLabel ?? xCopy.since} {formatDate(followedAt, locale)}
        </time>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref}>
          {xCopy.profile}
        </Link>
        {action}
      </div>
    </article>
  )
}
