import Link from 'next/link'
import type { ReactNode } from 'react'

type Props = {
  userId: string
  followedAt: string
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
 * Relationship facts come from the existing W05 DTO; this component owns no
 * relationship reads or mutations. Both modes use the reference's Tailwind utilities.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, action, presentation = 'legacy', locale = 'zh' }: Props) {
  const profileHref = '/users/' + encodeURIComponent(userId)
  const initial = userId.trim().slice(0, 1).toUpperCase() || 'L'
  const xCopy = locale === 'en'
    ? { user: 'User', since: 'Relationship since', profile: 'View profile' }
    : locale === 'tw'
      ? { user: '使用者', since: '關係建立於', profile: '查看個人主頁' }
      : { user: '用户', since: '关系建立于', profile: '查看主页' }

  if (presentation === 'x-timeline') {
    return (
      <article className="flex flex-col gap-3 border-b border-light-border px-4 py-4 sm:flex-row sm:items-center sm:gap-4 dark:border-dark-border">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-base font-bold" aria-hidden="true">{initial}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold">{xCopy.user} {userId}</h3>
          <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">{xCopy.since} {formatDate(followedAt, locale)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref} >{xCopy.profile}</Link>
          {action}
        </div>
      </article>
    )
  }

  return (
    <article className="flex min-w-0 items-center gap-4 border-b border-light-border px-4 py-4 dark:border-dark-border">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-base font-bold" aria-hidden="true">
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold">用户 {userId}</h3>
        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
          关系建立于 {formatDate(followedAt, locale)}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref}>
          查看主页
        </Link>
        {action}
      </div>
    </article>
  )
}
