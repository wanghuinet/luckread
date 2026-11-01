'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../lib/client-api.js'
import { buildPublicContentHref } from '../../../lib/public-content-url.js'
import LuckReadSocialPostCard from '../components/reuse/LuckReadSocialPostCard'
import ArticleSummaryPreview from '../../../components/ArticleSummaryPreview.js'
import { usePublicLocale } from '../i18n/PublicLanguageToggle'
import { getPublicCopy, type PublicLocale } from '../i18n/public-locale'
import TwitterCloneSecondaryPageLayout from '../../(twitter-clone)/TwitterCloneSecondaryPageLayout'

type ContentType = 'article' | 'post' | 'video'
type PublicAuthor = {
  id: string
  username?: string
  displayName?: string | null
  avatar?: string | null
}

type ContentItem = {
  id: string
  slug?: string
  creatorId?: string | null
  creator?: PublicAuthor | null
  author?: PublicAuthor | null
  createdAt?: string
  contentType: ContentType
  title: string
  bodyRef?: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}
type ContentPage = {
  items: ContentItem[]
  nextCursor: string | null
  hasMore: boolean
}
type ContentApiResponse = {
  data?: ContentPage
  error?: { message?: string } | null
}

const dateLocale = (locale: PublicLocale) => locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'

export default function ContentBrowsePage() {
  const locale = usePublicLocale()
  const copy = getPublicCopy(locale)
  const contentLoadError = copy.content.error
  const labels: Record<ContentType | 'all', string> = {
    all: copy.content.tabs.all,
    article: copy.content.tabs.article,
    post: copy.content.tabs.post,
    video: copy.content.tabs.video,
  }
  const [page, setPage] = useState<ContentPage>({ items: [], nextCursor: null, hasMore: false })
  const [contentType, setContentType] = useState<ContentType | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const abortControllerRef = useRef<AbortController | null>(null)

  const load = useCallback(async (
    cursor: string | null,
    selectedType: ContentType | 'all',
    fallbackError: string,
  ): Promise<void> => {
    const requestId = ++requestIdRef.current
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams({ limit: '18' })
      if (cursor) params.set('cursor', cursor)
      if (selectedType !== 'all') params.set('type', selectedType)

      const { response, data } = await fetchJson<ContentApiResponse>('/api/v1/contents?' + params.toString(), {
        headers: { accept: 'application/json' },
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      })
      if (!response.ok || !data?.data) {
        throw new Error(getApiErrorMessage(data, fallbackError))
      }

      if (requestId !== requestIdRef.current) return
      const next = data.data
      setPage((current) => {
        if (!cursor) return next
        const seen = new Set(current.items.map((item) => item.id))
        return {
          items: [...current.items, ...(next.items ?? []).filter((item) => !seen.has(item.id))],
          nextCursor: next.nextCursor,
          hasMore: next.hasMore,
        }
      })
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : fallbackError)
    } finally {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setLoading(false)
      setLoadingMore(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(null, contentType, contentLoadError)
    }, 0)
    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      window.clearTimeout(timer)
    }
  }, [contentLoadError, contentType, load])

  return (
    <TwitterCloneSecondaryPageLayout locale={locale} title={copy.content.title} active="explore">
      <section aria-busy={loading || loadingMore} className="flex flex-col">
        <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
          <p className="text-xs font-bold uppercase tracking-widest text-main-accent">{copy.content.eyebrow}</p>
          <p className="mt-2 text-sm leading-6 text-light-secondary dark:text-dark-secondary">{copy.content.description}</p>
          <Link className="mt-3 inline-flex items-center rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white transition hover:brightness-90" href="/publish">
            {copy.common.startCreating} ↗
          </Link>
        </header>

        <nav className="grid grid-cols-4 border-b border-light-border dark:border-dark-border" role="tablist" aria-label={copy.content.typeAria}>
          {(Object.keys(labels) as Array<ContentType | 'all'>).map((type) => (
            <button
              key={type}
              aria-selected={contentType === type}
              className={contentType === type
                ? 'main-tab relative flex min-h-14 items-center justify-center px-1 text-center text-sm font-bold hover:bg-white/5'
                : 'main-tab flex min-h-14 items-center justify-center px-1 text-center text-sm text-light-secondary hover:bg-white/5 dark:text-dark-secondary'}
              onClick={() => setContentType(type)}
              role="tab"
              type="button"
            >
              {labels[type]}
              {contentType === type ? <span className="absolute bottom-0 h-1 w-10 rounded-full bg-main-accent" /> : null}
            </button>
          ))}
        </nav>

        {loading ? (
          <section aria-label={copy.content.loadingAria} aria-busy="true">
            <p className="border-b border-light-border px-4 py-4 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">{copy.content.loading}</p>
            {Array.from({ length: 5 }, (_, index) => (
              <div className="animate-pulse border-b border-light-border px-4 py-5 dark:border-dark-border" key={index} aria-hidden="true">
                <span className="mb-3 block h-3 w-24 rounded-full bg-light-line-reply dark:bg-dark-line-reply" />
                <span className="mb-2 block h-5 w-4/5 rounded-full bg-light-line-reply dark:bg-dark-line-reply" />
                <span className="block h-4 w-2/3 rounded-full bg-light-line-reply dark:bg-dark-line-reply" />
              </div>
            ))}
          </section>
        ) : null}

        {!loading && error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status">
            <p>{error}</p>
            <button className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" onClick={() => void load(null, contentType, contentLoadError)} type="button">
              {copy.content.retry}
            </button>
          </div>
        ) : null}

        {!loading && !error && page.items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <p className="text-light-secondary dark:text-dark-secondary">
              {locale === 'tw'
                ? (contentType === 'all' ? '目前還沒有公開內容。' : '目前還沒有公開' + labels[contentType] + '。')
                : locale === 'en'
                  ? (contentType === 'all' ? 'No public content yet.' : 'No public ' + labels[contentType].toLowerCase() + ' yet.')
                  : (contentType === 'all' ? '还没有公开内容。' : '还没有公开' + labels[contentType] + '。')}
            </p>
            <Link className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white" href="/publish">{copy.content.firstPublish}</Link>
          </div>
        ) : null}

        {!loading && !error && page.items.length > 0 ? (
          <section aria-label={locale === 'en' ? 'Public content list' : locale === 'tw' ? '公開內容列表' : '公开内容列表'} className="flex flex-col">
            {page.items.map((item) => {
              if (item.contentType === 'post') {
                return (
                  <LuckReadSocialPostCard
                    key={item.id}
                    contentId={item.id}
                    slug={item.slug}
                    title={item.title}
                    creatorId={item.creatorId}
                    author={item.creator ?? item.author}
                    coverRef={item.coverRef}
                    mediaRefs={item.mediaRefs}
                    createdAt={item.createdAt}
                    updatedAt={item.updatedAt}
                    presentation="x-timeline"
                    locale={locale}
                  />
                )
              }
              const href = buildPublicContentHref(item)
              const cover = item.coverRef
              return (
                <Link
                  className="main-tab block border-b border-light-border px-4 py-4 transition hover:bg-white/5 dark:border-dark-border"
                  data-umami-event="content-open"
                  data-umami-event-content-type={item.contentType}
                  href={href}
                  key={item.id}
                >
                  <div className="flex items-center gap-2 text-xs text-light-secondary dark:text-dark-secondary">
                    <span>{labels[item.contentType]}</span>
                    <span aria-hidden="true">·</span>
                    <span>{copy.content.published}</span>
                    {item.updatedAt ? <time className="ml-auto" dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleDateString(dateLocale(locale))}</time> : null}
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-6">{item.title}</h2>
                  {item.contentType === 'article' ? (
                    <ArticleSummaryPreview
                      key={item.bodyRef || item.id}
                      bodyRef={item.bodyRef}
                      label={locale === 'en' ? 'Summary' : locale === 'tw' ? '文章摘要' : '文章摘要'}
                    />
                  ) : null}
                  {cover ? (
                    <div className="mt-3 overflow-hidden rounded-2xl border border-light-border dark:border-dark-border">
                      <img alt={item.title ? item.title + copy.content.cover : copy.content.cover} className="max-h-80 w-full object-cover" loading="lazy" src={cover} />
                    </div>
                  ) : null}
                  <span className="mt-3 inline-block text-sm font-bold text-main-accent">{copy.content.open}</span>
                </Link>
              )
            })}
          </section>
        ) : null}

        {!loading && !error && page.hasMore && page.nextCursor ? (
          <div className="flex justify-center px-4 py-5">
            <button
              aria-busy={loadingMore}
              className="rounded-full border border-light-border px-5 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
              disabled={loadingMore}
              onClick={() => void load(page.nextCursor, contentType, contentLoadError)}
              type="button"
            >
              {loadingMore ? copy.content.loading : copy.content.more}
            </button>
          </div>
        ) : null}
      </section>
    </TwitterCloneSecondaryPageLayout>
  )
}
