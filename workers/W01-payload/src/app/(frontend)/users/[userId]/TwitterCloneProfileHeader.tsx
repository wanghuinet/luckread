import type { ReactNode } from 'react'

import type { PublicLocale } from '../../i18n/public-locale'

export type TwitterCloneProfile = {
  id: string
  username: string
  displayName: string | null
  bio: string | null
  avatar: string | null
}

type Props = {
  profile: TwitterCloneProfile
  name: string
  initial: string
  following: number | null
  followers: number | null
  workCount: number
  locale: PublicLocale
  statusMessage?: string
  actions: ReactNode
}

const labelsFor = (locale: PublicLocale) => locale === 'en'
  ? { avatar: 'Profile photo', bio: 'No bio yet', following: 'Following', followers: 'Followers', works: 'Works' }
  : locale === 'tw'
    ? { avatar: '個人頭像', bio: '尚無個人簡介', following: '追蹤中', followers: '粉絲', works: '作品' }
    : { avatar: '头像', bio: '尚无个人简介', following: '关注', followers: '粉丝', works: '作品' }

const formatCount = (value: number | null, locale: PublicLocale) => value === null
  ? '—'
  : value.toLocaleString(locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN')

/**
 * Presentation-only adaptation of ccrsxx/twitter-clone's UserHomeLayout,
 * UserHomeAvatar and UserDetails structure. LuckRead remains the data and
 * policy authority; this component reuses the reference project's Tailwind
 * compositions instead of adding profile-specific CSS.
 */
export default function TwitterCloneProfileHeader({
  profile,
  name,
  initial,
  following,
  followers,
  workCount,
  locale,
  statusMessage,
  actions,
}: Props) {
  const labels = labelsFor(locale)

  return (
    <section aria-labelledby="creator-profile-title">
      <div aria-hidden="true" className="mt-0.5 h-36 bg-light-line-reply xs:h-48 sm:h-52 dark:bg-dark-line-reply" />

      <div className="relative flex flex-col gap-3 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="mb-8 shrink-0 xs:mb-14 sm:mb-16">
            <div
              aria-label={name + ' ' + labels.avatar}
              role="img"
              className="absolute -mt-3 grid aspect-square w-24 -translate-y-1/2 place-items-center overflow-hidden rounded-full border-4 border-main-background bg-main-sidebar-background text-3xl font-bold xs:w-32 sm:w-36"
            >
              {profile.avatar ? (
                <img alt="" className="h-full w-full object-cover" height={144} loading="eager" src={profile.avatar} width={144} />
              ) : initial}
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-2">{actions}</div>
        </div>

        <div className="min-w-0">
          <h1 id="creator-profile-title" className="truncate text-xl font-bold">{name}</h1>
          <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">@{profile.username}</p>
          <p className="mt-3 max-w-2xl whitespace-pre-wrap break-words text-sm leading-6">
            {profile.bio?.trim() ? profile.bio : <span className="text-light-secondary dark:text-dark-secondary">{labels.bio}</span>}
          </p>
        </div>
      </div>

      <dl
        aria-label={locale === 'en' ? 'Profile statistics' : locale === 'tw' ? '個人資料統計' : '个人资料统计'}
        className="flex flex-wrap gap-x-5 gap-y-2 border-t border-light-border px-4 py-4 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary [&>div>dd]:font-bold [&>div>dd]:text-light-primary dark:[&>div>dd]:text-dark-primary"
      >
        <div className="flex items-baseline gap-1.5"><dd>{formatCount(following, locale)}</dd><dt>{labels.following}</dt></div>
        <div className="flex items-baseline gap-1.5"><dd>{formatCount(followers, locale)}</dd><dt>{labels.followers}</dt></div>
        <div className="flex items-baseline gap-1.5"><dd>{formatCount(workCount, locale)}</dd><dt>{labels.works}</dt></div>
      </dl>

      {statusMessage ? (
        <p className="fixed bottom-20 right-5 z-50 max-w-[min(420px,calc(100%-2.5rem))] rounded-full bg-main-accent px-4 py-3 text-sm text-white shadow-lg" role="status">
          {statusMessage}
        </p>
      ) : null}
    </section>
  )
}
