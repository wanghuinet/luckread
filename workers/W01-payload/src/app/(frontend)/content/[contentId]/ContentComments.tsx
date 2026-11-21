'use client'

import Image from 'next/image'
import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'

import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import { getCachedPublicProfile, type PublicProfile } from '../../../../lib/social-post-profile-cache.js'
import { getPublicCopy, type PublicLocale } from '../../i18n/public-locale'
import DiscussionThread from './DiscussionThread'
import SocialMentionText, { type SocialMentionReference } from '../../../../components/SocialMentionText.js'

type CommentItem = {
  id: string
  contentId: string
  authorUserId: string
  parentId: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  createdAt: string
  updatedAt: string
  mentions?: SocialMentionReference[]
  likedByViewer?: boolean
}

type CommentPage = {
  items: CommentItem[]
  nextCursor: string | null
  hasMore: boolean
}

export default function ContentComments({
  contentId,
  viewerUserId,
  interactionRestricted = false,
  locale = 'zh',
}: {
  contentId: string
  viewerUserId: string | null
  interactionRestricted?: boolean
  locale?: PublicLocale
}) {
  const copy = getPublicCopy(locale)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const [comments, setComments] = useState<CommentItem[]>([])
  const [commentProfiles, setCommentProfiles] = useState<Record<string, PublicProfile>>({})
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [likedComments, setLikedComments] = useState<Record<string, boolean>>({})
  const [likingCommentId, setLikingCommentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reportingCommentId, setReportingCommentId] = useState<string | null>(null)
  const [reportReasonCode, setReportReasonCode] = useState('ABUSE')
  const [reportBusy, setReportBusy] = useState(false)
  const commentsRequestRef = useRef<AbortController | null>(null)
  const commentsRequestIdRef = useRef(0)

  const loadComments = useCallback(async (nextCursor: string | null = null) => {
    commentsRequestRef.current?.abort()
    const requestId = ++commentsRequestIdRef.current
    const controller = new AbortController()
    commentsRequestRef.current = controller
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (nextCursor) params.set('cursor', nextCursor)
      const { response, data } = await fetchJson<{ data?: CommentPage; error?: { message?: string } }>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments?' + params.toString(),
        {
          headers: { accept: 'application/json' },
          cache: 'no-store',
          signal: controller.signal,
        },
      )
      if (!response.ok || !data?.data) {
        throw new Error(getApiErrorMessage(data, copy.comments.loadError))
      }
      const page = data.data as CommentPage
      if (requestId !== commentsRequestIdRef.current) return
      const pageLikeState = Object.fromEntries(
        page.items.map((item) => [item.id, item.likedByViewer === true]),
      )
      setLikedComments((current) => nextCursor ? { ...current, ...pageLikeState } : pageLikeState)
      setComments((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      if (requestId !== commentsRequestIdRef.current) return
      setMessage(error instanceof Error ? error.message : copy.comments.loadError)
    } finally {
      if (requestId !== commentsRequestIdRef.current) return
      commentsRequestRef.current = null
      setLoading(false)
      setLoadingMore(false)
    }
  }, [contentId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadComments()
    }, 0)
    return () => {
      window.clearTimeout(timer)
      commentsRequestRef.current?.abort()
      commentsRequestRef.current = null
      commentsRequestIdRef.current += 1
    }
  }, [loadComments])

  useEffect(() => {
    let active = true
    const authorIds = [...new Set(comments.map((comment) => comment.authorUserId).filter(Boolean))]
    if (authorIds.length === 0) return () => { active = false }

    void Promise.all(authorIds.map(async (authorId) => {
      try {
        return [authorId, await getCachedPublicProfile(authorId)] as const
      } catch {
        return [authorId, null] as const
      }
    })).then((results) => {
      if (!active) return
      const resolved: Record<string, PublicProfile> = {}
      for (const [authorId, profile] of results) {
        if (profile) resolved[authorId] = profile
      }
      if (Object.keys(resolved).length > 0) {
        setCommentProfiles((current) => ({ ...current, ...resolved }))
      }
    })

    return () => { active = false }
  }, [comments])




  async function toggleCommentLike(comment: CommentItem) {
    if (likingCommentId) return
    setLikingCommentId(comment.id)
    setMessage('')
    try {
      const { response: statusResponse, data: statusData } = await fetchJson<{ data?: { liked?: boolean }; error?: { message?: string } }>(
        '/api/v1/interactions/likes?targetType=comment&targetId=' + encodeURIComponent(comment.id),
        {
          credentials: 'include',
          headers: { accept: 'application/json' },
          cache: 'no-store',
        },
      )

      if (statusResponse.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }

      if (!statusResponse.ok || typeof statusData?.data?.liked !== 'boolean') {
        setMessage(statusData?.data ? (locale === 'en' ? 'Could not read comment like status.' : locale === 'tw' ? '留言按讚狀態讀取失敗。' : '评论点赞状态读取失败。') : copy.comments.likeError)
        return
      }

      const liked = statusData.data.liked
      const method = liked ? 'DELETE' : 'POST'
      const { response, data } = await fetchJson<{ error?: { message?: string } }>('/api/v1/comments/' + encodeURIComponent(comment.id) + '/likes', {
        method,
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'Idempotency-Key': 'social-comment-like:' + crypto.randomUUID(),
        },
      })

      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok && response.status !== 204) {
        setMessage(getApiErrorMessage(data, copy.comments.likeError))
        return
      }

      setLikedComments((current) => ({ ...current, [comment.id]: !liked }))
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setLikingCommentId(null)
    }
  }

  async function deleteComment(comment: CommentItem) {
    if (deletingId || comment.authorUserId !== viewerUserId) return
    setDeletingId(comment.id)
    setMessage('')
    try {
      const { response, data } = await fetchJson<{ error?: { code?: string; message?: string } }>(
        '/api/v1/comments/' + encodeURIComponent(comment.id),
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'Idempotency-Key': 'social-comment-delete:' + crypto.randomUUID(),
          },
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok) {
        setMessage(
          data?.error?.code === 'COMMENT_HAS_REPLIES'
            ? copy.comments.tooManyReplies
            : getApiErrorMessage(data, copy.comments.deleteError),
        )
        return
      }
      setComments((current) => current.filter((item) => item.id !== comment.id))
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setDeletingId(null)
    }
  }

  async function updateComment(comment: CommentItem) {
    if (savingEdit || comment.authorUserId !== viewerUserId || !editBody.trim()) return
    setSavingEdit(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: CommentItem; error?: { message?: string } }>(
        '/api/v1/comments/' + encodeURIComponent(comment.id),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'social-comment-update:' + crypto.randomUUID(),
            'If-Match': '"' + comment.updatedAt + '"',
          },
          body: JSON.stringify({ body: editBody.trim() }),
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (response.status === 412) {
        setMessage(copy.comments.conflict)
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(getApiErrorMessage(data, copy.comments.updateError))
        return
      }
      const updated = data.data as CommentItem
      setComments((current) => current.map((item) => item.id === updated.id ? updated : item))
      setEditingId(null)
      setEditBody('')
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setSavingEdit(false)
    }
  }

  function openCommentReport(comment: CommentItem) {
    if (comment.authorUserId === viewerUserId) return
    if (!viewerUserId) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
      return
    }
    setMessage('')
    setReportReasonCode('ABUSE')
    setReportingCommentId(comment.id)
  }

  async function submitCommentReport() {
    const commentId = reportingCommentId
    if (!commentId || reportBusy || !reportReasonCode.trim()) return
    if (!viewerUserId) {
      const returnTo = window.location.pathname + window.location.search + window.location.hash
      window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
      return
    }

    setReportBusy(true)
    setMessage('')
    try {
      const { response, data } = await fetchJson<{ data?: { status?: string }; error?: { message?: string } }>('/api/v1/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'Idempotency-Key': 'report:comment:' + commentId + ':' + crypto.randomUUID(),
        },
        body: JSON.stringify({ targetType: 'comment', targetId: commentId, reasonCode: reportReasonCode }),
      })
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Report failed.' : locale === 'tw' ? '檢舉失敗，請稍後再試。' : '举报失败，请稍后重试。'))
      }
      setReportingCommentId(null)
      setMessage(data.data.status === 'DEDUPLICATED'
        ? (locale === 'en' ? 'You have already reported this comment.' : locale === 'tw' ? '你先前已檢舉過此留言。' : '你此前已举报过这条评论。')
        : (locale === 'en' ? 'Comment report submitted.' : locale === 'tw' ? '留言檢舉已提交。' : '评论举报已提交。'))
    } catch (error) {
      setMessage(error instanceof Error
        ? error.message
        : (locale === 'en' ? 'Report failed.' : locale === 'tw' ? '檢舉失敗，請稍後再試。' : '举报失败，请稍后重试。'))
    } finally {
      setReportBusy(false)
    }
  }

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setMessage('')
    const idempotencyKey = crypto.randomUUID()
    try {
      const { response, data } = await fetchJson<{ data?: CommentItem; error?: { message?: string } }>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': idempotencyKey,
          },
          body: JSON.stringify({ body: body.trim(), parentId: replyingTo }),
        },
      )
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(getApiErrorMessage(data, copy.comments.submitError))
        return
      }
      const created = data.data as CommentItem
      setComments((current) => [...current, created])
      setBody('')
      setReplyingTo(null)
    } catch {
      setMessage(copy.comments.networkError)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="content-comments" aria-labelledby="content-comments-heading">
      <div className="content-comments-heading">
        <h2 id="content-comments-heading">{copy.comments.title}</h2>
      </div>

      {!interactionRestricted ? (
        <form className="content-comment-form" onSubmit={submitComment}>
        <label htmlFor="content-comment-body">{copy.comments.formLabel}</label>
        <textarea
          id="content-comment-body"
          maxLength={10000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={replyingTo ? copy.comments.replyPlaceholder : copy.comments.commentPlaceholder}
          rows={4}
          value={body}
        />
        <div className="content-comment-form-actions">
          <span>{body.length}/10000</span>
          {replyingTo ? (
            <button disabled={submitting} onClick={() => { setReplyingTo(null); setBody('') }} type="button">{copy.comments.cancelReply}</button>
          ) : null}
          <button disabled={!body.trim() || submitting} type="submit">
            {submitting ? copy.comments.submitting : copy.comments.submit}
          </button>
          </div>
        </form>
      ) : (
        <p className="content-comment-message" role="status">{copy.comments.restricted}</p>
      )}

      {message && !reportingCommentId ? <p className="content-comment-message" role="status">{message}</p> : null}

      {loading ? (
        <p className="content-comment-state" role="status">{copy.comments.loading}</p>
      ) : comments.length === 0 ? (
        <p className="content-comment-state">{copy.comments.empty}</p>
      ) : (
        <DiscussionThread
          comments={comments}
          renderComment={(comment) => (
            <article className="content-comment-item" key={comment.id} style={{ marginInlineStart: Math.min(comment.depth, 3) * 24 }}>
              {(() => {
                const authorProfile = commentProfiles[comment.authorUserId]
                const authorName = authorProfile?.displayName?.trim() || authorProfile?.username?.trim() || copy.comments.reader
                const authorHref = authorProfile?.id
                  ? '/users/' + encodeURIComponent(authorProfile.id)
                  : '/users/' + encodeURIComponent(comment.authorUserId)
                const authorInitial = authorName.slice(0, 1).toUpperCase() || 'L'
                return (
                  <header className="flex items-center gap-2">
                    <Link
                      aria-label={authorName}
                      className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-main-sidebar-background text-xs font-bold text-main-accent"
                      href={authorHref}
                    >
                      {authorProfile?.avatar?.trim()
                        ? <Image alt="" className="h-8 w-8 rounded-full object-cover" height={32} loading="lazy" src={authorProfile.avatar} unoptimized width={32} />
                        : authorInitial}
                    </Link>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                      <Link className="font-bold hover:underline" href={authorHref}>{authorName}</Link>
                      {authorProfile?.username?.trim() ? (
                        <span className="text-sm text-light-secondary dark:text-dark-secondary">@{authorProfile.username.trim()}</span>
                      ) : null}
                      <time className="text-xs text-light-secondary dark:text-dark-secondary" dateTime={comment.createdAt}>
                        {new Date(comment.createdAt).toLocaleString(dateLocale, { hour12: false })}
                      </time>
                    </div>
                  </header>
                )
              })()}
              {editingId === comment.id ? (
                <div className="content-comment-form">
                  <label htmlFor={'content-comment-edit-' + comment.id}>{locale === 'en' ? 'Edit comment' : locale === 'tw' ? '編輯留言' : '编辑评论'}</label>
                  <textarea
                    id={'content-comment-edit-' + comment.id}
                    maxLength={10000}
                    onChange={(event) => setEditBody(event.target.value)}
                    rows={4}
                    value={editBody}
                  />
                  <div className="content-comment-form-actions">
                    <span>{editBody.length}/10000</span>
                    <button
                      disabled={savingEdit}
                      onClick={() => {
                        setEditingId(null)
                        setEditBody('')
                      }}
                      type="button"
                    >
                      {copy.comments.cancel}
                    </button>
                    <button
                      disabled={!editBody.trim() || savingEdit}
                      onClick={() => void updateComment(comment)}
                      type="button"
                    >
                      {savingEdit ? copy.comments.saving : copy.comments.save}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words">
                    <SocialMentionText text={comment.body} mentions={comment.mentions ?? []} />
                  </p>
                  {!interactionRestricted ? (
                    <button
                      className="content-comment-reply"
                      disabled={likingCommentId === comment.id}
                      onClick={() => void toggleCommentLike(comment)}
                      type="button"
                    >
                      {likingCommentId === comment.id
                        ? copy.comments.processing
                        : likedComments[comment.id]
                          ? copy.comments.liked
                          : copy.comments.like}
                    </button>
                  ) : null}
                  {comment.authorUserId === viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      onClick={() => {
                        setEditingId(comment.id)
                        setEditBody(comment.body)
                        setReplyingTo(null)
                        setMessage('')
                      }}
                      type="button"
                    >
                      {copy.comments.edit}
                    </button>
                  ) : null}
                  {comment.authorUserId !== viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      disabled={reportBusy}
                      onClick={() => openCommentReport(comment)}
                      type="button"
                    >
                      {locale === 'en' ? 'Report' : locale === 'tw' ? '檢舉' : '举报'}
                    </button>
                  ) : null}
                  {comment.authorUserId === viewerUserId ? (
                    <button
                      className="content-comment-reply"
                      disabled={deletingId === comment.id}
                      onClick={() => void deleteComment(comment)}
                      type="button"
                    >
                      {deletingId === comment.id ? copy.comments.deleting : copy.comments.delete}
                    </button>
                  ) : null}
                  {!interactionRestricted && comment.depth < 3 ? (
                    <button
                      className="content-comment-reply"
                      onClick={() => {
                        setReplyingTo(comment.id)
                        setBody('')
                        setMessage('')
                      }}
                      type="button"
                    >
                      {copy.comments.reply}
                    </button>
                  ) : null}
                </>
              )}
            </article>
          )}
        />
      )}

      {hasMore ? (
        <button
          className="content-comments-load-more"
          disabled={loadingMore}
          onClick={() => void loadComments(cursor)}
          type="button"
        >
          {loadingMore ? copy.content.loading : copy.comments.more}
        </button>
      ) : null}

      {reportingCommentId ? (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4 py-8"
          onClick={(event) => {
            if (event.target === event.currentTarget && !reportBusy) setReportingCommentId(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !reportBusy) setReportingCommentId(null)
          }}
        >
          <section
            aria-labelledby="comment-report-title"
            aria-modal="true"
            autoFocus
            className="w-full max-w-md rounded-2xl border border-light-border bg-main-background p-5 text-light-primary shadow-xl dark:border-dark-border dark:text-dark-primary"
            role="dialog"
            tabIndex={-1}
          >
            <h2 className="text-lg font-bold" id="comment-report-title">
              {locale === 'en' ? 'Report comment' : locale === 'tw' ? '檢舉留言' : '举报评论'}
            </h2>
            <p className="mt-2 text-sm text-light-secondary dark:text-dark-secondary">
              {locale === 'en' ? 'Choose the reason that best describes this comment.' : locale === 'tw' ? '請選擇最符合此留言情況的檢舉原因。' : '请选择最符合这条评论情况的举报原因。'}
            </p>
            {comments.find((comment) => comment.id === reportingCommentId) ? (
              <blockquote className="mt-3 line-clamp-3 rounded-xl bg-main-sidebar-background px-3 py-2 text-sm">
                {comments.find((comment) => comment.id === reportingCommentId)?.body}
              </blockquote>
            ) : null}
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
                    name="comment-report-reason"
                    onChange={() => setReportReasonCode(reason.value)}
                    type="radio"
                    value={reason.value}
                  />
                  <span className="text-sm">{reason.label}</span>
                </label>
              ))}
            </fieldset>
            {message ? (
              <p className="mt-3 text-sm text-light-secondary dark:text-dark-secondary" role="status">{message}</p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                className="content-comment-reply"
                disabled={reportBusy}
                onClick={() => setReportingCommentId(null)}
                type="button"
              >
                {locale === 'en' ? 'Cancel' : locale === 'tw' ? '取消' : '取消'}
              </button>
              <button
                className="rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                disabled={reportBusy || !reportReasonCode}
                onClick={() => void submitCommentReport()}
                type="button"
              >
                {reportBusy
                  ? (locale === 'en' ? 'Submitting…' : locale === 'tw' ? '提交中…' : '提交中…')
                  : (locale === 'en' ? 'Submit report' : locale === 'tw' ? '提交檢舉' : '提交举报')}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
