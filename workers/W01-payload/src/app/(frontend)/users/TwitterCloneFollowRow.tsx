import Link from 'next/link'
import type { ReactNode } from 'react'

type Props = {
  userId: string
  followedAt: string
  action?: ReactNode
}

const formatDate = (value: string): string => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

/**
 * Presentation-only adaptation of ccrsxx/twitter-clone's UserCard/UserCards.
 * It receives the canonical W05 relationship DTO and optional action slot;
 * this component never reads or mutates social state itself.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, action }: Props) {
  const profileHref = '/users/' + encodeURIComponent(userId)
  const initial = userId.trim().slice(0, 1).toUpperCase() || 'L'

  return (
    <article className="creator-profile-card twitter-follow-row">
      <Link className="twitter-follow-row__identity" href={profileHref}>
        <span className="creator-profile-avatar twitter-follow-row__avatar" aria-hidden="true">{initial}</span>
        <span className="creator-profile-card-body twitter-follow-row__details">
          <h3>用户 {userId}</h3>
          <time dateTime={followedAt}>关系建立于 {formatDate(followedAt)}</time>
        </span>
      </Link>

      <div className="content-detail-actions twitter-follow-row__actions">
        <Link className="content-detail-follow twitter-follow-row__profile-link" href={profileHref}>查看主页</Link>
        {action}
      </div>
    </article>
  )
}
