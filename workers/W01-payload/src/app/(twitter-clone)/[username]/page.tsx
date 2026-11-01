'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { usePublicLocale } from '../../(frontend)/i18n/PublicLanguageToggle'
import TwitterCloneSecondaryPageLayout from '../TwitterCloneSecondaryPageLayout'
import UserProfilePage from '../../(frontend)/users/[userId]/UserProfilePage'

type PublicUserLookup = {
  id?: string
  error?: { message?: string }
}

export default function UsernameProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const locale = usePublicLocale()
  const [userId, setUserId] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const { username } = await params
        const normalizedUsername = username.trim().replace(/^@+/, '')
        const { response, data } = await fetchJson<PublicUserLookup>('/api/v1/users/by-username/' + encodeURIComponent(normalizedUsername), {
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

  const title = locale === 'en' ? 'Profile' : locale === 'tw' ? '個人主頁' : '个人主页'

  if (error) {
    return (
      <TwitterCloneSecondaryPageLayout locale={locale} title={title} active="profile">
        <div className="flex flex-col items-start gap-3 px-4 py-8 text-sm" role="alert">
          <p>{error}</p>
          <Link className="rounded-full border border-light-border px-4 py-2 font-bold dark:border-dark-border" href="/content">
            {locale === 'en' ? 'Explore content' : locale === 'tw' ? '探索內容' : '返回发现'}
          </Link>
        </div>
      </TwitterCloneSecondaryPageLayout>
    )
  }

  if (!userId) {
    return (
      <TwitterCloneSecondaryPageLayout locale={locale} title={title} active="profile">
        <p className="px-4 py-5 text-sm text-light-secondary dark:text-dark-secondary" role="status" aria-busy="true">
          {locale === 'en' ? 'Loading author profile…' : locale === 'tw' ? '正在載入作者資料…' : '正在加载作者资料…'}
        </p>
      </TwitterCloneSecondaryPageLayout>
    )
  }

  return <UserProfilePage params={Promise.resolve({ userId })} />
}
