'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import type { PublicLocale } from '../../i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

type ShareResponse = {
  data?: {
    shareId?: string
    contentId?: string
  }
  error?: { message?: string }
}

const pageCopy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Shared content',
      opening: 'Opening shared content…',
      unavailableTitle: 'This share link cannot be opened',
      invalid: 'This share link is invalid.',
      missing: 'This content is unavailable or no longer published.',
      unavailable: 'This shared content is temporarily unavailable.',
      discover: 'Explore content',
    }
  : locale === 'tw'
    ? {
        title: '分享內容',
        opening: '正在開啟分享內容…',
        unavailableTitle: '無法開啟此分享連結',
        invalid: '分享連結無效。',
        missing: '分享內容不存在或已下架。',
        unavailable: '目前暫時無法開啟分享內容。',
        discover: '探索內容',
      }
    : {
        title: '分享内容',
        opening: '正在打开分享内容…',
        unavailableTitle: '分享链接无法打开',
        invalid: '分享链接无效。',
        missing: '分享内容不存在或已下线。',
        unavailable: '分享内容暂时无法打开。',
        discover: '去发现内容',
      }

export default function ShareLandingPage({
  params,
}: {
  params: Promise<{ shareId: string }>
}) {
  const router = useRouter()
  const locale = usePublicLocale()
  const labels = pageCopy(locale)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const { shareId } = await params
        if (!shareId?.trim()) throw new Error(labels.invalid)

        const { response, data } = await fetchJson<ShareResponse>('/api/v1/shares/' + encodeURIComponent(shareId), {
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok || typeof data?.data?.contentId !== 'string' || !data.data.contentId) {
          throw new Error(getApiErrorMessage(data, labels.missing))
        }

        router.replace('/content/' + encodeURIComponent(data.data.contentId))
      } catch (cause) {
        if (controller.signal.aborted) return
        setError(cause instanceof Error ? cause.message : labels.unavailable)
      }
    })()

    return () => controller.abort()
  }, [labels.invalid, labels.missing, labels.unavailable, params, router])

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={labels.title} active="explore">
      {error ? (
        <section className="flex flex-col gap-3 border-b border-light-border px-4 py-6 dark:border-dark-border">
          <h2 className="text-lg font-bold" role="alert">{labels.unavailableTitle}</h2>
          <p className="text-sm leading-6 text-light-secondary dark:text-dark-secondary">{error}</p>
          <div>
            <Link className="inline-flex rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white transition hover:brightness-90" href="/content">
              {labels.discover}
            </Link>
          </div>
        </section>
      ) : (
        <p className="border-b border-light-border px-4 py-5 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status" aria-busy="true">
          {labels.opening}
        </p>
      )}
    </TwitterCloneSecondaryPageLayout>
  )
}
