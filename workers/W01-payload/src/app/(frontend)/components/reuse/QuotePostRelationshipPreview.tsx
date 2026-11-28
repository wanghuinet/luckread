'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import type { PublicLocale } from '../../i18n/public-locale'

type RelationshipPage = {
  items?: Array<{
    relationType?: unknown
    direction?: unknown
    relatedContent?: { id?: unknown } | null
  }>
}

type ContentRecord = {
  id?: string
  title?: string
  contentType?: string
  state?: string
  accessMode?: string
}

type QuotePreviewState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'error' }
  | { status: 'ready'; contentId: string; title: string }

export default function QuotePostRelationshipPreview({
  contentId,
  locale = 'zh',
}: {
  contentId: string
  locale?: PublicLocale
}) {
  const probeRef = useRef<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const [retryNonce, setRetryNonce] = useState(0)
  const [state, setState] = useState<QuotePreviewState>({ status: 'loading' })
  const english = locale === 'en'
  const traditional = locale === 'tw'

  useEffect(() => {
    if (visible) return
    const probe = probeRef.current
    if (!probe) return
    if (typeof IntersectionObserver === 'undefined') {
      queueMicrotask(() => setVisible(true))
      return
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: '320px 0px' })
    observer.observe(probe)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    let active = true
    queueMicrotask(() => { if (active) setState({ status: 'loading' }) })

    void (async () => {
      const relationshipResult = await fetchJson<{ data?: RelationshipPage } | RelationshipPage>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/relationships?direction=out&limit=20',
        {
          credentials: 'omit',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        },
      )
      if (!relationshipResult.response.ok) {
        throw new Error(getApiErrorMessage(relationshipResult.data, 'Unable to load quoted post.'))
      }
      const relationshipPayload = relationshipResult.data && typeof relationshipResult.data === 'object' && 'data' in relationshipResult.data
        ? relationshipResult.data.data
        : relationshipResult.data as RelationshipPage | null
      const relation = relationshipPayload?.items?.find((item) =>
        item.relationType === 'quote-post' && item.direction === 'out',
      )
      const targetId = relation?.relatedContent?.id
      if (typeof targetId !== 'string' || !targetId.trim()) {
        if (active) setState({ status: 'none' })
        return
      }

      const targetResult = await fetchJson<{ data?: ContentRecord } | ContentRecord>(
        '/api/v1/contents/' + encodeURIComponent(targetId),
        {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        },
      )
      if (!targetResult.response.ok) {
        throw new Error(getApiErrorMessage(targetResult.data, 'Unable to load quoted post.'))
      }
      const targetPayload = targetResult.data && typeof targetResult.data === 'object' && 'data' in targetResult.data
        ? targetResult.data.data
        : targetResult.data as ContentRecord | null
      if (
        !targetPayload ||
        targetPayload.id !== targetId ||
        targetPayload.contentType !== 'post' ||
        targetPayload.state !== 'PUBLISHED' ||
        targetPayload.accessMode !== 'PUBLIC'
      ) {
        if (active) setState({ status: 'none' })
        return
      }
      if (active && !controller.signal.aborted) {
        setState({
          status: 'ready',
          contentId: targetPayload.id,
          title: typeof targetPayload.title === 'string' ? targetPayload.title : '',
        })
      }
    })().catch(() => {
      if (active && !controller.signal.aborted) setState({ status: 'error' })
    })

    return () => {
      active = false
      controller.abort()
    }
  }, [contentId, visible, retryNonce])

  return (
    <>
      <div aria-hidden="true" className="h-px" ref={probeRef} />
      {!visible || state.status === 'none' ? null : state.status === 'loading' ? (
        <div className="mt-3 rounded-xl border border-light-border px-3 py-3 text-xs text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">{english ? 'Loading quoted post…' : traditional ? '正在載入引用原帖…' : '正在加载引用原帖…'}</div>
      ) : state.status === 'error' ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-light-border px-3 py-3 text-xs text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">
          <span>{english ? 'Quoted post is temporarily unavailable.' : traditional ? '引用原帖暫時無法顯示。' : '引用原帖暂时无法显示。'}</span>
          <button className="font-semibold text-main-accent" onClick={() => setRetryNonce((value) => value + 1)} type="button">
            {english ? 'Retry' : traditional ? '重試' : '重试'}
          </button>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-light-border dark:border-dark-border">
      <Link
        aria-label={english ? 'Open quoted post' : traditional ? '打開引用原帖' : '打开引用原帖'}
        className="block px-3 py-3 transition hover:bg-light-primary/5 dark:hover:bg-white/5"
        href={'/content/' + encodeURIComponent(state.contentId)}
      >
        <span className="mb-2 block text-xs font-semibold text-light-secondary dark:text-dark-secondary">
          {english ? 'Quoted post' : traditional ? '引用原帖' : '引用原帖'}
        </span>
        <span className="block whitespace-pre-wrap break-words text-sm leading-5 text-light-primary dark:text-dark-primary">
          {state.title || (english ? 'Original post' : traditional ? '原帖內容' : '原帖内容')}
        </span>
        <span className="mt-2 block text-xs text-main-accent">
          {english ? 'View original post' : traditional ? '查看原帖' : '查看原帖'}
        </span>
      </Link>
        </div>
      )}
    </>
  )
}
