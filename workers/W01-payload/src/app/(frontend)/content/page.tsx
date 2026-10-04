'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'

import PublicLanguageToggle from '../i18n/PublicLanguageToggle'
import { getPublicCopy, readPublicLocaleCookie, type PublicLocale } from '../i18n/public-locale'

type ContentType = 'article' | 'post' | 'video'
type ContentItem = {
  id: string
  contentType: ContentType
  title: string
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

export default function ContentBrowsePage() {
  const [locale, setLocale] = useState<PublicLocale>('zh')
  const copy = getPublicCopy(locale)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLocale(readPublicLocaleCookie())
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
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

  const load = useCallback(async (cursor: string | null = null): Promise<void> => {
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
      if (contentType !== 'all') params.set('type', contentType)

      const response = await fetch('/api/v1/contents?' + params.toString(), {
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      })
      const data: ContentApiResponse = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || getPublicCopy(locale).content.error)
      }

      if (requestId !== requestIdRef.current) return
      const next = data.data as ContentPage
      setPage((current) =>
        cursor
          ? { items: [...current.items, ...(next.items ?? [])], nextCursor: next.nextCursor, hasMore: next.hasMore }
          : next,
      )
    } catch (cause) {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : '内容加载失败')
    } finally {
      if (requestId !== requestIdRef.current || controller.signal.aborted) return
      setLoading(false)
      setLoadingMore(false)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    }
  }, [contentType, locale])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => {
      requestIdRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      window.clearTimeout(timer)
    }
  }, [load])

  return (
    <main className="content-browse">
      <header className="content-browse-top">
        <div>
          <p className="eyebrow">{copy.content.eyebrow}</p>
          <h1>{copy.content.title}</h1>
          <p>{copy.content.description}</p>
        </div>
        <div className="content-browse-actions">
          <Link className="button button-quiet" href="/">{copy.common.backHome}</Link>
          <Link className="button button-primary" href="/publish">{copy.common.startCreating} ↗</Link>
          <PublicLanguageToggle locale={locale} />
        </div>
      </header>

      <div className="content-browse-actions" role="tablist" aria-label={copy.content.typeAria}>
        {(Object.keys(labels) as Array<ContentType | 'all'>).map((type) => (
          <button
            key={type}
            aria-selected={contentType === type}
            className={contentType === type ? 'button button-primary' : 'button button-quiet'}
            onClick={() => setContentType(type)}
            role="tab"