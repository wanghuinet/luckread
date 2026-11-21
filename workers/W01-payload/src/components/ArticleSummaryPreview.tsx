'use client'

import { useEffect, useRef, useState } from 'react'

import { apiFetch } from '../lib/client-api.js'

import {
  extractArticleSummary,
  resolvePublicArticleBodyUrl,
} from '../lib/article-summary-preview.js'

type Props = {
  bodyRef?: string | null
  label: string
}

/**
 * Lazily loads an article's existing public body file only as its summary
 * preview approaches the viewport. It never mutates content or adds an API.
 */
export default function ArticleSummaryPreview({ bodyRef, label }: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!bodyRef) return

    const root = rootRef.current
    if (!root) return

    const controller = new AbortController()
    let started = false

    const load = async () => {
      if (started) return
      started = true
      const url = resolvePublicArticleBodyUrl(bodyRef, window.location.origin)
      if (!url) {
        setFailed(true)
        return
      }

      setLoading(true)
      try {
        const response = await apiFetch(url, {
          method: 'GET',
          credentials: 'omit',
          cache: 'force-cache',
          referrerPolicy: 'no-referrer',
          signal: controller.signal,
        })
        if (!response.ok) {
          setFailed(true)
          return
        }
        const raw = await response.text()
        if (controller.signal.aborted) return
        const excerpt = extractArticleSummary(raw)
        if (excerpt) setSummary(excerpt)
        else setFailed(true)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
        // A missing or inaccessible preview must not block the canonical content link.
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    if (typeof IntersectionObserver === 'undefined') {
      void load()
      return () => controller.abort()
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        void load()
      }
    }, { rootMargin: '320px 0px' })

    observer.observe(root)
    return () => {
      observer.disconnect()
      controller.abort()
    }
  }, [bodyRef])

  if (!bodyRef || (!loading && failed)) return null

  return (
    <div ref={rootRef} aria-label={label}>
      <span className="content-feed-meta">{label}</span>
      {summary ? (
        <p className="content-detail-action-status">{summary}</p>
      ) : (
        <span className="content-feed-skeleton-line content-feed-skeleton-line-title" aria-hidden="true" />
      )}
    </div>
  )
}
