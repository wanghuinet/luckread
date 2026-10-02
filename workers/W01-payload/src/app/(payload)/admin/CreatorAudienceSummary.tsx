'use client'

import { useEffect, useState } from 'react'

import styles from './creator-center.module.css'

type CountValue = number | null

type FollowListResponse = {
  data?: {
    totalCount?: number
  }
}

type AudienceState = {
  followers: CountValue
  following: CountValue
  error: boolean
}

const initialState: AudienceState = {
  followers: null,
  following: null,
  error: false,
}

async function fetchCount(path: string, signal: AbortSignal): Promise<number> {
  const response = await fetch(path, {
    headers: { accept: 'application/json' },
    credentials: 'include',
    cache: 'no-store',
    signal,
  })
  const data = await response.json().catch((): null => null) as FollowListResponse | null
  if (!response.ok || typeof data?.data?.totalCount !== 'number') {
    throw new Error('AUDIENCE_LOAD_FAILED')
  }
  return Math.max(0, data.data.totalCount)
}

export default function CreatorAudienceSummary({ userId }: { userId: string }) {
  const [state, setState] = useState<AudienceState>(initialState)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    void Promise.all([
      fetchCount('/api/v1/users/' + encodeURIComponent(userId) + '/followers?limit=1', controller.signal),
      fetchCount('/api/v1/users/' + encodeURIComponent(userId) + '/following?limit=1', controller.signal),
    ])
      .then(([followers, following]) => {
        if (cancelled) return
        setState({ followers, following, error: false })
      })
      .catch((error: unknown) => {
        if (cancelled || controller.signal.aborted) return
        setState({ followers: null, following: null, error: true })
        console.error('Creator audience summary failed', error)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [userId, reloadKey])

  const formatCount = (value: CountValue) => value === null ? '—' : value.toLocaleString('zh-CN')

  return (
    <section className={styles.sectionBlock} id="audience">
      <div className={styles.sectionTitle}>
        <div>
          <span className={styles.eyebrow}>AUDIENCE</span>
          <h2>粉丝关系</h2>
          <p>直接读取现有 Social/W05 关系数据，查看当前账号的粉丝与关注规模。</p>
        </div>
        <button
          className={styles.secondaryButton + ' btn'}
          disabled={!state.error}
          onClick={() => setReloadKey((value) => value + 1)}
          type="button"
        >
          {state.error ? '重新加载' : '已同步'}
        </button>
      </div>

      <div className={styles.futureGrid}>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-users" aria-hidden="true" /> FOLLOWERS
          </span>
          <strong>{formatCount(state.followers)}</strong>
          <span>关注你的用户数量。</span>
        </article>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> FOLLOWING
          </span>
          <strong>{formatCount(state.following)}</strong>
          <span>你主动关注的用户数量。</span>
        </article>
        <article className={styles.futureCard}>
          <span className={styles.futureKicker}>
            <i className="fa-solid fa-link" aria-hidden="true" /> SOURCE
          </span>
          <strong>W05 Social</strong>
          <span>{state.error ? '关系数据暂时无法同步。' : '不复制关系数据，由 Social 作为唯一关系事实来源。'}</span>
        </article>
      </div>
    </section>
  )
}
