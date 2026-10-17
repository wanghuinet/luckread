import Link from 'next/link'
import type { ReactNode } from 'react'

type Props = {
  userId: string
  followedAt: string
  action?: ReactNode
  presentation?: 'legacy' | 'x-timeline'
}

const formatDate = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Presentation-only adaptation of ccrsxx/twitter-clone's UserCard/UserCards.
 * Relationship facts come from the existing W05 DTO; this component owns no
 * relationship reads or mutations. It composes only existing LuckRead styles.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, action, presentation = 'legacy' }: Props) {
  const profileHref = '/users/' + encodeURIComponent(userId)
  const initial = userId.trim().slice(0, 1).toUpperCase() || 'L'

  if (presentation === 'x-timeline') {
    return (
      <article className="flex flex-col gap-3 border-b border-light-border px-4 py-4 sm:flex-row sm:items-center sm:gap-4 dark:border-dark-border">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-base font-bold" aria-hidden="true">{initial}</span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-bold">用户 {userId}</h3>
          <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">关系建立于 {formatDate(followedAt)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref}>查看主页</Link>
          {action}
        </div>
      </article>
    )
  }

  return (
    <article className="creator-profile-stats">
      <div>
        <span className="creator-profile-circle-button" aria-hidden="true">
          <span>{initial}</span>
        </span>
      </div>
      <div className="creator-profile-card-body">
        <h3>用户 {userId}</h3>
        <time dateTime={followedAt}>关系建立于 {formatDate(followedAt)}</time>
      </div>
      <div>
        <div className="content-detail-actions">
          <Link className="content-detail-follow" href={profileHref}>查看主页</Link>
          {action}
        </div>
      </div>
    </article>
  )
}
