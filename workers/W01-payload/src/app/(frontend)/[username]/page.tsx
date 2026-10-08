'use client'

import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import UserProfilePage from '../users/[userId]/page'

type PublicUserLookup = {
  id?: string
  error?: { message?: string }
}

export default function UsernameProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const { username } = await params
        const { response, data } = await fetchJson<PublicUserLookup>('/api/v1/users/by-username/' + encodeURIComponent(username), {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok || typeof data?.id !== 'string' || !data.id) {
          throw new Error(getApiErrorMessage(data, '用户不存在。'))
        }
        if (!cancelled) setUserId(data.id)
      } catch (cause) {
        if (cancelled || controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : '暂时无法加载该用户资料。')
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [params])

  if (error) {
    return (
      <main className="content-detail">
        <div className="content-detail-state" role="alert">{error}</div>
      </main>
    )
  }

  if (!userId) {
    return (
      <main className="content-detail" aria-busy="true">
        <p className="content-detail-state" role="status">正在加载作者资料…</p>
      </main>
    )
  }

  return <UserProfilePage params={Promise.resolve({ userId })} />
}
