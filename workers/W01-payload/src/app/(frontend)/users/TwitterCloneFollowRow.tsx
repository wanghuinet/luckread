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
 * Relationship facts come from the existing W05 DTO; this component owns no
 * relationship reads or mutations. It composes only existing LuckRead styles.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, action }: Props) {
  const profileHref = '/users/' + encodeURIComponent(userId)
  const initial = userId.trim().slice(0, 1).toUpperCase() || 'L'

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
