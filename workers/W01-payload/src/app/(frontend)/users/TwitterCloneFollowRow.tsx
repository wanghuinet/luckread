import Link from 'next/link'
import type { ReactNode } from 'react'

type PublicProfileSummary = {
  username: string
  displayName: string | null
  avatar: string | null
  bio: string | null
}

type Props = {
  userId: string
  followedAt: string
  profile?: PublicProfileSummary
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
 * relationship reads or mutations. It composes only existing LuckRead styles.
 */
export default function TwitterCloneFollowRow({ userId, followedAt, profile, action, presentation = 'legacy', locale = 'zh' }: Props) {
  const profileHref = '/users/' + encodeURIComponent(userId)
  const displayName = profile?.displayName?.trim() || profile?.username || (locale === 'en' ? 'User' : locale === 'tw' ? '使用者' : '用户')
  const handle = profile?.username ? '@' + profile.username.replace(/^@/, '') : null
  const initial = (profile?.displayName?.trim() || profile?.username || 'L').trim().slice(0, 1).toUpperCase() || 'L'
  const xCopy = locale === 'en'
    ? { user: 'User', since: 'Relationship since', profile: 'View profile' }
    : locale === 'tw'
      ? { user: '使用者', since: '關係建立於', profile: '查看個人主頁' }
      : { user: '用户', since: '关系建立于', profile: '查看主页' }

  if (presentation === 'x-timeline') {
    return (
      <article className="flex flex-col gap-3 border-b border-light-border px-4 py-4 sm:flex-row sm:items-start sm:gap-4 dark:border-dark-border">
        {profile?.avatar ? (
          <Link href={profileHref} aria-label={displayName + ' profile'} className="block h-12 w-12 shrink-0 overflow-hidden rounded-full bg-main-sidebar-background">
            <img alt="" className="h-full w-full object-cover" height={48} loading="lazy" src={profile.avatar} width={48} />
          </Link>
        ) : (
          <Link href={profileHref} aria-label={displayName + ' profile'} className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-main-sidebar-background text-base font-bold">
            {initial}
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <Link href={profileHref} className="block min-w-0 hover:underline">
            <h3 className="truncate text-sm font-bold">{displayName}</h3>
            {handle ? <p className="truncate text-sm text-light-secondary dark:text-dark-secondary">{handle}</p> : null}
          </Link>
          {profile?.bio?.trim() ? (
            <p className="mt-1 line-clamp-2 break-words text-sm text-light-primary dark:text-dark-primary">{profile.bio}</p>
          ) : null}
          <p className="mt-1 text-xs text-light-secondary dark:text-dark-secondary">{xCopy.since} {formatDate(followedAt, locale)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" href={profileHref}>{xCopy.profile}</Link>
          {action}
        </div>
      </article>
    )
  }

  return (
    <article className="creator-profile-stats">
      <div>
        {profile?.avatar ? <img alt="" className="h-10 w-10 rounded-full object-cover" height={40} loading="lazy" src={profile.avatar} width={40} /> : (
          <span className="creator-profile-circle-button" aria-hidden="true"><span>{initial}</span></span>
        )}
      </div>
      <div className="creator-profile-card-body">
        <h3>{displayName}</h3>
        {handle ? <p>{handle}</p> : null}
        {profile?.bio?.trim() ? <p>{profile.bio}</p> : null}
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
