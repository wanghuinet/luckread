import type { ReactNode } from 'react'

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
  statusMessage?: string
  actions: ReactNode
}

/**
 * Presentation-only adaptation of ccrsxx/twitter-clone's UserHomeLayout,
 * UserHomeAvatar and UserDetails structure. It deliberately receives profile
 * data and action slots from the parent: LuckRead remains the data and policy
 * authority.
 */
export default function TwitterCloneProfileHeader({
  profile,
  name,
  initial,
  following,
  followers,
  workCount,
  statusMessage,
  actions,
}: Props) {
  return (
    <section className="creator-profile-hero" aria-labelledby="creator-profile-title">
      <div className="creator-profile-cover" aria-hidden="true" />
      <div className="creator-profile-hero-main">
        <div className="creator-profile-avatar" aria-label={name + ' 头像'}>
          {profile.avatar ? (
            <img alt="" height={96} loading="eager" src={profile.avatar} width={96} />
          ) : initial}
        </div>

        <div className="creator-profile-identity">
          <h1 id="creator-profile-title">{name}</h1>
          <p className="creator-profile-handle">@{profile.username}</p>
          <p className={'creator-profile-bio' + (profile.bio?.trim() ? '' : ' is-placeholder')}>
            {profile.bio?.trim() ? profile.bio : '尚无个人简介'}
          </p>
        </div>

        {actions}
      </div>

      <dl className="creator-profile-stats" aria-label="作者数据">
        <div>
          <dt>关注</dt>
          <dd>{following === null ? '—' : following.toLocaleString('zh-CN')}</dd>
        </div>
        <div>
          <dt>粉丝</dt>
          <dd>{followers === null ? '—' : followers.toLocaleString('zh-CN')}</dd>
        </div>
        <div>
          <dt>作品</dt>
          <dd>{workCount.toLocaleString('zh-CN')}</dd>
        </div>
      </dl>

      {statusMessage ? <p className="creator-profile-global-message" role="status">{statusMessage}</p> : null}
    </section>
  )
}
