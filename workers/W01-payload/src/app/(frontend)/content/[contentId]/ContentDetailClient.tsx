'use client'

import Link from 'next/link'
import ContentComments from './ContentComments'
import ContentLikesModal from './ContentLikesModal'
import ArticleStructuredRenderer from '../../../../components/ArticleStructuredRenderer.js'
import { tryDeserializeArticleDocument } from '../../../../lib/article-document.js'
import { useEffect, useMemo, useState } from 'react'

import { apiFetch, fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import PublicLanguageToggle, { usePublicLocale } from '../../i18n/PublicLanguageToggle'
import { getPublicCopy, type PublicLocale } from '../../i18n/public-locale'

type ContentType = 'article' | 'post' | 'video'
type Content = {
  id: string
  slug?: string
  creatorId?: string | null
  contentType: ContentType
  state: string
  title: string
  accessMode?: 'PUBLIC' | 'MEMBERS_ONLY' | string
  accessGranted?: boolean
  bodyRef?: string | null
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}
type MembershipPlan = {
  planId: string
  creatorId: string
  planVersion: number
  name: string
  tier: string
  billingInterval: 'MONTHLY' | 'YEARLY'
  priceMinor: number
  currency: string
  benefits: string[]
}

const splitBodyIntoParagraphs = (value: string): string[] =>
  value
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)

const formatMembershipPrice = (amountMinor: number, currency: string, locale: string): string => {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
  const fractionDigits = formatter.resolvedOptions().maximumFractionDigits
  return formatter.format(amountMinor / (10 ** fractionDigits))
}

export default function ContentDetailPage({
  params,
  initialContent,
  showLanguageToggle = true,
}: {
  params: Promise<{ contentId: string }>
  initialContent?: Content
  showLanguageToggle?: boolean
}) {
  const locale = usePublicLocale()
  const Root = showLanguageToggle ? 'main' : 'section'
  const copy = getPublicCopy(locale)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const typeLabels: Record<ContentType, string> = {
    article: copy.content.tabs.article,
    post: copy.content.tabs.post,
    video: copy.content.tabs.video,
  }

  const [content, setContent] = useState<Content | null>(initialContent ?? null)
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(!initialContent)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [liked, setLiked] = useState(false)
  const [likeCount, setLikeCount] = useState<number | null>(null)
  const [likeBusy, setLikeBusy] = useState(false)
  const [likesOpen, setLikesOpen] = useState(false)
  const [bookmarked, setBookmarked] = useState(false)
  const [bookmarkBusy, setBookmarkBusy] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [reportReasonCode, setReportReasonCode] = useState('SPAM')
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [following, setFollowing] = useState(false)
  const [interactionRestricted, setInteractionRestricted] = useState(false)
  const [followRestricted, setFollowRestricted] = useState(false)
  const [followBusy, setFollowBusy] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const [membershipPlans, setMembershipPlans] = useState<MembershipPlan[]>([])
  const [membershipPlansCreatorId, setMembershipPlansCreatorId] = useState<string | null>(null)
  const [membershipPlansLoading, setMembershipPlansLoading] = useState(false)
  const [membershipPurchasePlanId, setMembershipPurchasePlanId] = useState<string | null>(null)
  const [membershipPurchaseError, setMembershipPurchaseError] = useState('')
  const membershipLocked = content?.accessMode === 'MEMBERS_ONLY' && content.accessGranted !== true
  const membershipPlansMatchContent = membershipPlansCreatorId !== null && membershipPlansCreatorId === content?.creatorId
  const visibleMembershipPlans = membershipPlansMatchContent ? membershipPlans : []
  const visibleMembershipPlansLoading = membershipLocked && (!membershipPlansMatchContent || membershipPlansLoading)
  const visibleMembershipPurchaseError = membershipPlansMatchContent ? membershipPurchaseError : ''
  const [socialTopics, setSocialTopics] = useState<Array<{ topicId: string; name: string; displayName: string }>>([])
  const [socialMentions, setSocialMentions] = useState<Array<{ userId: string; handle: string }>>([])
  const structuredArticle = useMemo(
    () => content?.contentType === 'article' && body ? tryDeserializeArticleDocument(body) : null,
    [content?.contentType, body],
  )

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timer = window.setTimeout((): void => {
      void (async () => {
        try {
          const { contentId } = await params
          let resolved = initialContent
          let viewerData: { id?: string } | null = null

          if (!resolved || retryKey > 0 || initialContent?.accessMode === 'MEMBERS_ONLY') {
            const [contentResult, viewerResult] = await Promise.all([
              fetchJson<Content>(`/api/v1/contents/${encodeURIComponent(contentId)}`, {
                credentials: 'include',
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
              }),
              fetchJson<{ id?: string }>('/api/v1/users/me', {
                credentials: 'include',
                headers: { accept: 'application/json' },
                cache: 'no-store',
                signal: controller.signal,
              }),
            ])
            const { response, data } = contentResult
            viewerData = viewerResult.data
            if (!response.ok || !data?.id || data.state !== 'PUBLISHED') {
              throw new Error(copy.detail.notFound)
            }
            resolved = data
            if (cancelled) return
            setContent(resolved)
          } else {
            const viewerResult = await fetchJson<{ id?: string }>('/api/v1/users/me', {
              credentials: 'include',
              headers: { accept: 'application/json' },
              cache: 'no-store',
              signal: controller.signal,
            })
            viewerData = viewerResult.data
          }

          if (cancelled || !resolved) return
          setViewerUserId(typeof viewerData?.id === 'string' ? viewerData.id : null)
          try {
            const { response: socialResponse, data: socialData } = await fetchJson<{
              data?: {
                counts?: { likes?: number; comments?: number; favorites?: number; shares?: number }
                viewer?: { liked?: boolean; favorited?: boolean } | null
                topics?: Array<{ topicId: string; name: string; displayName: string }>
                mentions?: Array<{ userId: string; handle: string }>
              }
            }>(
              '/api/v1/contents/' + encodeURIComponent(resolved.id) + '/social',
              { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
            )
            if (!cancelled && socialResponse.ok && socialData?.data) {
              const summary = socialData.data
              if (typeof summary.counts?.likes === 'number') setLikeCount(Math.max(0, summary.counts.likes))
              if (typeof summary.viewer?.liked === 'boolean') setLiked(summary.viewer.liked)
              if (typeof summary.viewer?.favorited === 'boolean') setBookmarked(summary.viewer.favorited)
              setSocialTopics(Array.isArray(summary.topics) ? summary.topics : [])
              setSocialMentions(Array.isArray(summary.mentions) ? summary.mentions : [])
            }
          } catch {
            // Unified social summary is optional; individual actions remain usable.
          }
          if (resolved.creatorId) {
            try {
              const { response: followResponse, data: followData } = await fetchJson<{
                data?: {
                  following?: boolean
                  relationship?: { blocked?: boolean; blockedBy?: boolean }
                }
              }>(
                '/api/v1/social/follows/' + encodeURIComponent(resolved.creatorId),
                { credentials: 'include', headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
              )
              if (!cancelled && followResponse.ok) {
                const blocked = Boolean(followData?.data?.relationship?.blocked)
                const blockedBy = Boolean(followData?.data?.relationship?.blockedBy)
                setInteractionRestricted(blocked || blockedBy)
                setFollowRestricted(blocked || blockedBy)
                setFollowing(!blocked && !blockedBy && followData?.data?.following === true)
              }
            } catch {
              // Follow state is optional; content remains readable when the status query fails.
            }
          }
          if (resolved.accessGranted !== false && resolved.bodyRef) {
            try {
              const bodyResponse = await apiFetch(resolved.bodyRef, { cache: 'no-store', signal: controller.signal })
              if (bodyResponse.ok && !cancelled) setBody(await bodyResponse.text())
            } catch {
              // Body media is optional; metadata/media should still render.
            }
          }
        } catch (cause) {
          if (cancelled || controller.signal.aborted) return
          if (cause instanceof DOMException && cause.name === 'AbortError') return
          setError(copy.detail.notFound)
        } finally {
          if (!cancelled) setLoading(false)
        }
      })()
    }, 0)

    return () => {
      cancelled = true
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [initialContent, params, retryKey])

  useEffect(() => {
    if (!membershipLocked || !content?.creatorId) return
    const creatorId = content.creatorId
    const controller = new AbortController()
    let active = true
    void (async () => {
      // Move state transitions off the synchronous effect call stack; this
      // also lets render derive a loading shell while creator IDs differ.
      await Promise.resolve()
      if (!active || controller.signal.aborted) return
      setMembershipPlansCreatorId(creatorId)
      setMembershipPlans([])
      setMembershipPlansLoading(true)
      setMembershipPurchaseError('')
      try {
        const { response, data } = await fetchJson<{ data?: { docs?: unknown[] }; error?: { message?: unknown } }>('/api/v1/plans?limit=50', {
          credentials: 'include',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        })
        if (!active || controller.signal.aborted) return
        if (response.status === 401) {
          setMembershipPurchaseError(locale === 'en'
            ? 'Sign in to view membership offers.'
            : locale === 'tw' ? '登入後即可查看會員方案。' : '登录后即可查看会员套餐。')
          return
        }
        if (!response.ok) {
          setMembershipPurchaseError(getApiErrorMessage(data, copy.detail.networkError))
          return
        }
        const docs = Array.isArray(data?.data?.docs) ? data.data.docs : []
        const plans = docs.filter((value): value is MembershipPlan => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false
          const plan = value as Record<string, unknown>
          return typeof plan.planId === 'string' &&
            /^plan_[a-f0-9]{64}$/.test(plan.planId) &&
            plan.creatorId === creatorId &&
            Number.isSafeInteger(plan.planVersion) && (plan.planVersion as number) > 0 &&
            typeof plan.name === 'string' &&
            (plan.billingInterval === 'MONTHLY' || plan.billingInterval === 'YEARLY') &&
            typeof plan.priceMinor === 'number' && Number.isSafeInteger(plan.priceMinor) && plan.priceMinor > 0 &&
            typeof plan.currency === 'string' && /^[A-Z]{3}$/.test(plan.currency) &&
            Array.isArray(plan.benefits) &&
            plan.benefits.every((item) => typeof item === 'string')
        }) as MembershipPlan[]
        setMembershipPlans(plans)
        if (plans.length === 0) {
          setMembershipPurchaseError(locale === 'en'
            ? 'This creator has no active public membership offer yet.'
            : locale === 'tw' ? '此創作者目前沒有可購買的公開會員方案。' : '该创作者目前没有可购买的公开会员套餐。')
        }
      } catch {
        if (active && !controller.signal.aborted) setMembershipPurchaseError(copy.detail.networkError)
      } finally {
        if (active) setMembershipPlansLoading(false)
      }
    })()
    return () => {
      active = false
      controller.abort()
    }
  }, [membershipLocked, content?.creatorId, locale, copy.detail.networkError])

  if (loading) {
    return <Root aria-busy={loading} className="flex min-w-0 flex-col"><p className="flex min-h-40 items-center justify-center px-4 py-12 text-sm text-light-secondary dark:text-dark-secondary" role="status">{copy.detail.loading}</p></Root>
  }

  if (error || !content) {
    return (
      <Root className="flex min-w-0 flex-col">
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 py-12 text-center text-sm text-light-secondary dark:text-dark-secondary">
          <p>{error || copy.detail.notFound}</p>
          <button className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10" onClick={() => { setError(''); setLoading(true); setContent(null); setBody(''); setRetryKey((value) => value + 1) }} type="button">{copy.detail.retry}</button>
          <Link href="/">{copy.common.backHome}</Link>
        </div>
      </Root>
    )
  }


  async function purchaseMembership(plan: MembershipPlan) {
    if (membershipPurchasePlanId) return
    setMembershipPurchasePlanId(plan.planId)
    setMembershipPurchaseError('')
    try {
      const storageKey = 'luckread.membership-order.' + (content?.id ?? 'content') + '.' + plan.planId
      let idempotencyKey = ''
      try {
        idempotencyKey = window.sessionStorage.getItem(storageKey) ?? ''
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(idempotencyKey)) {
          idempotencyKey = window.crypto.randomUUID()
          window.sessionStorage.setItem(storageKey, idempotencyKey)
        }
      } catch {
        throw new Error(locale === 'en'
          ? 'Secure retry storage is unavailable. Enable session storage and try again.'
          : locale === 'tw' ? '無法安全保存重試識別碼，請啟用工作階段儲存後再試。' : '无法安全保存重试标识，请启用会话存储后重试。')
      }
      const { response, data } = await fetchJson<{ data?: { orderId?: unknown }; error?: { message?: unknown } }>('/api/v1/commerce/orders', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ items: [{ itemRef: plan.planId, quantity: 1 }] }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      const orderId = data?.data?.orderId
      if (!response.ok || typeof orderId !== 'string' || !/^ord_[A-Za-z0-9_-]{1,90}$/.test(orderId)) {
        setMembershipPurchaseError(getApiErrorMessage(
          data,
          response.status === 503
            ? (locale === 'en'
              ? 'Checkout is not available yet. No membership has been activated.'
              : locale === 'tw' ? '結帳尚未開放，會員資格尚未啟用。' : '结账尚未开放，会员资格尚未启用。')
            : (locale === 'en'
              ? 'Checkout failed. No membership has been activated.'
              : locale === 'tw' ? '結帳失敗，會員資格尚未啟用。' : '结账失败，会员资格尚未启用。'),
        ))
        return
      }
      try { window.sessionStorage.removeItem(storageKey) } catch { /* The server-side order remains authoritative. */ }
      window.location.assign('/checkout?orderId=' + encodeURIComponent(orderId))
    } catch (cause) {
      setMembershipPurchaseError(cause instanceof Error ? cause.message : copy.detail.networkError)
    } finally {
      setMembershipPurchasePlanId(null)
    }
  }

  async function toggleLike() {
    if (!content || likeBusy) return
    setLikeBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/interactions/likes', {
        method: liked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'Idempotency-Key': 'social-like:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: content.id }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        setActionMessage(getApiErrorMessage(data, copy.detail.networkError))
        return
      }
      const nextLiked = !liked
      setLiked(nextLiked)
      setLikeCount((count) => {
        if (count === null) return count
        return Math.max(0, count + (nextLiked ? 1 : -1))
      })
    } catch {
      setActionMessage(copy.detail.networkError)
    } finally {
      setLikeBusy(false)
    }
  }

  async function toggleBookmark() {
    if (!content || bookmarkBusy) return
    setBookmarkBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/interactions/bookmarks', {
        method: bookmarked ? 'DELETE' : 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'Idempotency-Key': 'social-bookmark:' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'content', targetId: content.id }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        setActionMessage(getApiErrorMessage(data, copy.detail.networkError))
        return
      }
      setBookmarked((value) => !value)
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setBookmarkBusy(false)
    }
  }

  async function toggleFollow() {
    if (!content?.creatorId || followBusy) return
    setFollowBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { following?: boolean }; error?: { message?: string } }>(
        '/api/v1/social/follows/' + encodeURIComponent(content.creatorId),
        {
          method: following ? 'DELETE' : 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-follow:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        setActionMessage(getApiErrorMessage(data, copy.detail.networkError))
        return
      }
      if (following) {
        setFollowing(false)
        return
      }
      if (typeof data?.data?.following !== 'boolean') {
        setActionMessage(copy.detail.networkError)
        return
      }
      setFollowing(data.data.following)
    } catch {
      setActionMessage('网络异常，请稍后重试。')
    } finally {
      setFollowBusy(false)
    }
  }

  async function submitReport() {
    if (!content || reportBusy || !reportReasonCode.trim()) return

    setReportBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'report:content:' + content.id + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({
          targetType: 'content',
          targetId: content.id,
          reasonCode: reportReasonCode,
        }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, 'REPORT_FAILED'))
      setActionMessage(
        data.data.status === 'DEDUPLICATED'
          ? (locale === 'en' ? 'Report recorded: you have already reported this content.' : locale === 'tw' ? '檢舉已記錄：你先前已檢舉過此內容。' : '举报已记录：你此前已举报过该内容。')
          : (locale === 'en' ? 'Report submitted.' : locale === 'tw' ? '檢舉已提交。' : '举报已提交。'),
      )
      setReportDialogOpen(false)
    } catch {
      setActionMessage(locale === 'en' ? 'Could not submit the report. Please try again.' : locale === 'tw' ? '檢舉提交失敗，請稍後再試。' : '举报提交失败，请稍后重试。')
    } finally {
      setReportBusy(false)
    }
  }

  async function copyContentLink() {
    if (shareBusy) return
    setShareBusy(true)
    setActionMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { shareId?: string }; error?: { message?: string } }>(
        '/api/v1/content/' + encodeURIComponent(content.id) + '/shares',
        {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'social-share:' + crypto.randomUUID(),
          },
          body: JSON.stringify({ contentId: content.id }),
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      const shareId = data?.data?.shareId
      if (!response.ok || typeof shareId !== 'string' || !shareId) {
        setActionMessage(copy.detail.linkError)
        return
      }
      const shareUrl = window.location.origin + '/s/' + encodeURIComponent(shareId)

      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({ title: content.title, url: shareUrl })
          setActionMessage(copy.detail.shareOpened)
          return
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === 'AbortError') return
          // Native sharing may be unavailable or blocked; fall back to clipboard.
        }
      }

      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setActionMessage(locale === 'en' ? 'Network error. Could not generate a share link.' : locale === 'tw' ? '網路異常，暫時無法產生分享連結。' : '网络异常，暂时无法生成分享链接。')
    } finally {
      setShareBusy(false)
    }
  }

  return (
    <Root className="flex min-w-0 flex-col">
      <div className="flex flex-col gap-3 border-b border-light-border px-4 py-3 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link className="main-tab rounded-full px-3 py-2 font-bold hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" href="/content">{copy.detail.backDiscover}</Link>
          <Link className="main-tab rounded-full px-3 py-2 font-bold hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" href="/">{copy.common.home}</Link>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mr-1 text-xs text-light-secondary dark:text-dark-secondary">{typeLabels[content.contentType]} · {copy.detail.published}</span>
          {content.creatorId ? (
            <>
              <Link className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" href={'/users/' + encodeURIComponent(content.creatorId)}>{copy.detail.author}</Link>
              {viewerUserId === content.creatorId ? (
                <span className="text-sm text-light-secondary dark:text-dark-secondary">{copy.detail.own}</span>
              ) : followRestricted ? (
                <span className="text-sm text-light-secondary dark:text-dark-secondary">{copy.detail.restricted}</span>
              ) : (
                <button className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={followBusy} onClick={() => void toggleFollow()} type="button">
                  {followBusy ? copy.comments.processing : following ? copy.detail.following : copy.detail.follow}
                </button>
              )}
            </>
          ) : null}
          {!interactionRestricted ? (
            <>
              {likeCount !== null && likeCount > 0 ? (
                <button
                  aria-haspopup="dialog"
                  aria-label={locale === 'en' ? (likeCount === 1 ? '1 like' : likeCount.toLocaleString(dateLocale) + ' likes') : locale === 'tw' ? likeCount.toLocaleString(dateLocale) + ' 個讚' : likeCount.toLocaleString(dateLocale) + ' 个赞'}
                  className="main-tab rounded-full px-3 py-2 text-sm font-bold hover:bg-light-primary/10 dark:hover:bg-dark-primary/10"
                  onClick={() => setLikesOpen(true)}
                  type="button"
                >
                  {locale === 'en'
                    ? likeCount.toLocaleString(dateLocale) + (likeCount === 1 ? ' Like' : ' Likes')
                    : locale === 'tw'
                      ? likeCount.toLocaleString(dateLocale) + ' 個讚'
                      : likeCount.toLocaleString(dateLocale) + ' 个赞'}
                </button>
              ) : null}
              <button className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={likeBusy} onClick={() => void toggleLike()} type="button">
                {likeBusy ? copy.comments.processing : liked ? copy.detail.liked : copy.detail.like}
                {likeCount === null ? '' : ' · ' + likeCount.toLocaleString(dateLocale)}
              </button>
            </>
          ) : null}
          <button className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={bookmarkBusy} onClick={() => void toggleBookmark()} type="button">
            {bookmarkBusy ? copy.comments.processing : bookmarked ? copy.detail.favorited : copy.detail.favorite}
          </button>
          <button className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10" disabled={shareBusy} onClick={() => void copyContentLink()} type="button">
            {shareBusy ? copy.detail.generating : copied ? copy.detail.copied : copy.detail.share}
          </button>
          {viewerUserId && viewerUserId !== content.creatorId ? (
            <button
              className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 disabled:cursor-wait disabled:opacity-50 dark:border-dark-border dark:hover:bg-dark-primary/10"
              disabled={reportBusy}
              onClick={() => {
                setActionMessage('')
                setReportReasonCode('SPAM')
                setReportDialogOpen(true)
              }}
              type="button"
            >
              {reportBusy ? copy.detail.reporting : copy.detail.report}
            </button>
          ) : null}
          {actionMessage ? <span className="text-sm text-light-secondary dark:text-dark-secondary" role="status">{actionMessage}</span> : null}
        </div>
      </div>
      <article className="flex min-w-0 flex-col border-b border-light-border dark:border-dark-border">
        <header className="px-4 py-5">
          {showLanguageToggle ? <div className="mb-2 flex justify-end"><PublicLanguageToggle locale={locale} /></div> : null}
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-main-accent">LUCKREAD CONTENT</p>
          <h1 className="break-words text-xl font-bold leading-6 sm:text-2xl">{content.title}</h1>
          {content.updatedAt ? (
            <time className="mt-2 block text-sm text-light-secondary dark:text-dark-secondary" dateTime={content.updatedAt}>
              {copy.detail.updatedAt} {new Date(content.updatedAt).toLocaleString(dateLocale, { hour12: false })}
            </time>
          ) : null}
        </header>

        {membershipLocked ? (
          <section aria-labelledby="membership-paywall-title" className="m-4 rounded-2xl border border-light-border p-5 dark:border-dark-border">
            <h2 className="text-lg font-bold" id="membership-paywall-title">
              {locale === 'en' ? 'Members-only content' : locale === 'tw' ? '會員專屬內容' : '会员专属内容'}
            </h2>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
              {locale === 'en'
                ? 'Subscribe to this creator to unlock the full text, images and video. Your access is verified by LuckRead after payment.'
                : locale === 'tw'
                  ? '訂閱此創作者即可解鎖全文、圖片和影片。付款後由 LuckRead 伺服器確認會員資格。'
                  : '订阅该创作者即可解锁全文、图片和视频。付款后由 LuckRead 服务器确认会员资格。'}
            </p>
            {visibleMembershipPlansLoading ? (
              <p className="mt-4 text-sm" role="status">{locale === 'en' ? 'Loading membership offers…' : locale === 'tw' ? '正在載入會員方案…' : '正在加载会员套餐…'}</p>
            ) : visibleMembershipPlans.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {visibleMembershipPlans.map((plan) => (
                  <div className="rounded-xl border border-light-border p-4 dark:border-dark-border" key={plan.planId}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-bold">{plan.name}</h3>
                        <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">
                          {plan.billingInterval === 'YEARLY'
                            ? (locale === 'en' ? 'Annual membership' : locale === 'tw' ? '年繳會員' : '年度会员')
                            : (locale === 'en' ? 'Monthly membership' : locale === 'tw' ? '月繳會員' : '月度会员')}
                        </p>
                      </div>
                      <strong className="text-base">{formatMembershipPrice(plan.priceMinor, plan.currency, dateLocale)}</strong>
                    </div>
                    {plan.benefits.length > 0 ? (
                      <ul className="mt-3 list-disc pl-5 text-sm text-light-secondary dark:text-dark-secondary">
                        {plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
                      </ul>
                    ) : null}
                    <button
                      className="mt-4 rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-50"
                      disabled={membershipPurchasePlanId !== null}
                      onClick={() => void purchaseMembership(plan)}
                      type="button"
                    >
                      {membershipPurchasePlanId === plan.planId
                        ? (locale === 'en' ? 'Preparing checkout…' : locale === 'tw' ? '正在準備結帳…' : '正在准备结账…')
                        : (locale === 'en' ? 'Subscribe and pay' : locale === 'tw' ? '訂閱並付款' : '订阅并付款')}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {visibleMembershipPurchaseError ? (
              <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{visibleMembershipPurchaseError}</p>
            ) : null}
            {!viewerUserId ? (
              <Link className="mt-4 inline-flex rounded-full border border-light-border px-4 py-2 text-sm font-bold hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                href={'/login?returnTo=' + encodeURIComponent(typeof window === 'undefined' ? '/content/' + content.id : window.location.pathname + window.location.search)}>
                {locale === 'en' ? 'Sign in to continue' : locale === 'tw' ? '登入後繼續' : '登录后继续'}
              </Link>
            ) : null}
          </section>
        ) : null}

        {!membershipLocked && content.contentType === 'video' && content.mediaRefs?.length ? (
          <div className="grid gap-1">
            {content.mediaRefs.map((url, index) => (
              <video
                className="block max-h-[720px] w-full bg-black object-cover"
                aria-label={content.title + ' ' + copy.detail.video + ' ' + (index + 1)}
                controls
                key={url}
                playsInline
                preload={index === 0 ? 'metadata' : 'none'}
                poster={index === 0 ? content.coverRef || undefined : undefined}
                src={url}
              />
            ))}
          </div>
        ) : null}

        {!membershipLocked && content.contentType !== 'video' && (content.coverRef || (content.mediaRefs?.length && !structuredArticle)) ? (
          <div className="grid gap-1">
            {content.coverRef ? (
              <img alt={content.title + ' ' + copy.detail.cover} className="block max-h-[720px] w-full object-cover" loading="eager" src={content.coverRef} />
            ) : null}
            {content.mediaRefs
              ?.filter((url) => url !== content.coverRef)
              .map((url, index) => (
                <img alt={content.title + ' ' + copy.detail.image + ' ' + (index + 1)} className="block max-h-[720px] w-full object-cover" key={url} loading="lazy" src={url} />
              ))}
          </div>
        ) : null}

        {!membershipLocked && (socialTopics.length > 0 || socialMentions.length > 0) ? (
          <section aria-label={copy.detail.tagAria} className="flex flex-wrap gap-2 border-b border-light-border px-4 py-3 dark:border-dark-border">
            {socialTopics.map((topic) => (
              <Link
                className="main-tab rounded-full border border-light-border px-3 py-1.5 text-sm text-main-accent hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                href={'/topics/' + encodeURIComponent(topic.name)}
                key={'topic:' + topic.topicId}
              >
                #{topic.displayName}
              </Link>
            ))}
            {socialMentions.map((mention) => (
              <Link
                className="main-tab rounded-full border border-light-border px-3 py-1.5 text-sm text-main-accent hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10"
                href={'/users/' + encodeURIComponent(mention.userId)}
                key={'mention:' + mention.userId}
              >
                @{mention.handle}
              </Link>
            ))}
          </section>
        ) : null}

        {!membershipLocked && !(content.contentType === 'post' && body.trim() === content.title.trim()) ? (
          <div className="px-4 py-4 sm:py-6">
            {structuredArticle ? (
              <ArticleStructuredRenderer document={structuredArticle} />
            ) : body ? (
              <div className="flex flex-col gap-4">{splitBodyIntoParagraphs(body).map((paragraph, index) => (
                <p className="whitespace-pre-wrap break-words text-[15px] leading-6 text-light-primary dark:text-dark-primary" key={index}>{paragraph}</p>
              ))}</div>
            ) : (
              <p className="text-sm text-light-secondary dark:text-dark-secondary">{copy.detail.bodyPreparing}</p>
            )}
          </div>
        ) : null}
      </article>
      {!membershipLocked ? (
        <ContentComments
          contentId={content.id}
          viewerUserId={viewerUserId}
          interactionRestricted={interactionRestricted}
          locale={locale}
        />
      ) : null}
      {reportDialogOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget && !reportBusy) setReportDialogOpen(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !reportBusy) setReportDialogOpen(false)
          }}
        >
          <section
            aria-labelledby="content-report-title"
            aria-modal="true"
            className="w-full max-w-md rounded-2xl border border-light-border bg-main-background p-5 shadow-xl dark:border-dark-border"
            role="dialog"
          >
            <h2 className="text-lg font-bold" id="content-report-title">
              {locale === 'en' ? 'Report content' : locale === 'tw' ? '檢舉內容' : '举报内容'}
            </h2>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
              {locale === 'en' ? 'Choose the reason that best describes this content.' : locale === 'tw' ? '請選擇最符合此內容情況的檢舉原因。' : '请选择最符合此内容情况的举报原因。'}
            </p>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="sr-only">
                {locale === 'en' ? 'Report reason' : locale === 'tw' ? '檢舉原因' : '举报原因'}
              </legend>
              {[
                { value: 'SPAM', label: locale === 'en' ? 'Spam or unwanted promotion' : locale === 'tw' ? '垃圾訊息或廣告' : '垃圾信息或广告' },
                { value: 'ABUSE', label: locale === 'en' ? 'Abuse or harassment' : locale === 'tw' ? '騷擾或辱罵' : '骚扰或辱骂' },
                { value: 'IMPERSONATION', label: locale === 'en' ? 'Impersonation' : locale === 'tw' ? '冒充他人' : '冒充他人' },
                { value: 'COPYRIGHT', label: locale === 'en' ? 'Copyright infringement' : locale === 'tw' ? '侵犯版權' : '侵犯版权' },
                { value: 'OTHER', label: locale === 'en' ? 'Other' : locale === 'tw' ? '其他原因' : '其他原因' },
              ].map((reason) => (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 hover:bg-light-primary/10 dark:hover:bg-dark-primary/10" key={reason.value}>
                  <input
                    checked={reportReasonCode === reason.value}
                    className="h-4 w-4 accent-main-accent"
                    name="content-report-reason"
                    onChange={() => setReportReasonCode(reason.value)}
                    type="radio"
                    value={reason.value}
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </fieldset>
            {actionMessage ? (
              <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{actionMessage}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="main-tab rounded-full border border-light-border px-4 py-2 text-sm font-bold dark:border-dark-border"
                disabled={reportBusy}
                onClick={() => setReportDialogOpen(false)}
                type="button"
              >
                {locale === 'en' ? 'Cancel' : locale === 'tw' ? '取消' : '取消'}
              </button>
              <button
                className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={reportBusy || !reportReasonCode}
                onClick={() => void submitReport()}
                type="button"
              >
                {reportBusy
                  ? copy.detail.reporting
                  : locale === 'en' ? 'Submit report' : locale === 'tw' ? '提交檢舉' : '提交举报'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {likesOpen ? (
        <ContentLikesModal
          contentId={content.id}
          likeCount={likeCount}
          locale={locale}
          onClose={() => setLikesOpen(false)}
        />
      ) : null}
    </Root>
  )
}
