import Link from 'next/link'
import type { ReactNode } from 'react'

import styles from './TwitterCloneFollowRow.module.css'

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
    <article className={styles.row}>
      <Link className={styles.identity} href={profileHref}>
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span className={styles.details}>
          <strong className={styles.displayName}>用户 {userId}</strong>
          <span className={styles.userId}>LuckRead 用户</span>
          <time className={styles.followedAt} dateTime={followedAt}>
            关系建立于 {formatDate(followedAt)}
          </time>
        </span>
      </Link>

      <div className={styles.actions}>
        <Link className={styles.profileLink} href={profileHref}>查看主页</Link>
        {action}
      </div>
    </article>
  )
}
