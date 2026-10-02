'use client'

import Link from 'next/link'
import { FormEvent, useCallback, useEffect, useState } from 'react'

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
}

type CommentPage = {
  items: CommentItem[]
  nextCursor: string | null
  hasMore: boolean
}

export default function ContentComments({ contentId }: { contentId: string }) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [replyingTo, setReplyingTo] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const activeControllerRef = useRef<AbortController | null>(null)

  const loadComments = useCallback(async (nextCursor: string | null = null) => {
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    activeControllerRef.current?.abort()
    const controller = new AbortController()
    activeControllerRef.current = controller
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await fetch(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments?' + params.toString(),
        { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal },
      )
      const data = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || '评论加载失败')
      }
      if (activeControllerRef.current !== controller) return
      const page = data.data as CommentPage
      setComments((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return
      if (activeControllerRef.current !== controller) return
      setMessage(error instanceof Error ? error.message : '评论加载失败')
    } finally {
      if (activeControllerRef.current === controller) {
        activeControllerRef.current = null
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [contentId])

  useEffect(() => {
    let disposed = false
    const timer = window.setTimeout(() => {
      if (disposed) return
      void loadComments()
    }, 0)
    return () => {
      disposed = true
      window.clearTimeout(timer)
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
    }
  }, [loadComments])

  async function submitComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!body.trim() || submitting) return
    setSubmitting(true)
    setMessage('')
    const idempotencyKey = crypto.randomUUID()
    try {
      const response = await fetch(
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
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        const returnTo = window.location.pathname + window.location.search + window.location.hash
        window.location.assign('/login?returnTo=' + encodeURIComponent(returnTo))
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(data?.error?.message || '评论提交失败，请稍后重试。')
        return
      }
      const created = data.data as CommentItem
      setComments((current) => [...current, created])
      setBody('')
      setReplyingTo(null)
    } catch {
      setMessage('网络异常，请稍后重试。')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="content-comments" aria-labelledby="content-comments-heading">
      <div className="content-comments-heading">
        <h2 id="content-comments-heading">评论</h2>
      </div>

      <form className="content-comment-form" onSubmit={submitComment}>
        <label htmlFor="content-comment-body">发表评论</label>
        <textarea
          id="content-comment-body"
          maxLength={10000}
          onChange={(event) => setBody(event.target.value)}
          placeholder={replyingTo ? '写下你的回复…' : '写下你的看法…'}
          rows={4}
          value={body}
        />
        <div className="content-comment-form-actions">
          <span>{body.length}/10000</span>
          {replyingTo ? (
            <button disabled={submitting} onClick={() => { setReplyingTo(null); setBody('') }} type="button">取消回复</button>
          ) : null}
          <button disabled={!body.trim() || submitting} type="submit">
            {submitting ? '提交中…' : '发表评论'}
          </button>
        </div>
      </form>

      {message ? <p className="content-comment-message" role="status">{message}</p> : null}

      {loading ? (
        <p className="content-comment-state" role="status">正在加载评论…</p>
      ) : comments.length === 0 ? (
        <p className="content-comment-state">还没有评论，来发表第一条吧。</p>
      ) : (
        <div className="content-comment-list">
          {comments.map((comment) => (
            <article
              className="content-comment-item"
              key={comment.id}
              style={{ marginInlineStart: Math.min(comment.depth, 3) * 24 }}
            >
              <header>
                <strong>读者</strong>
                <Link href={'/users/' + encodeURIComponent(comment.authorUserId)}>
                  查看主页
                </Link>
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </header>
              <p>{comment.body}</p>
              {comment.depth < 3 ? (
                <button
                  className="content-comment-reply"
                  onClick={() => {
                    setReplyingTo(comment.id)
                    setBody('')
                    setMessage('')
                  }}
                  type="button"
                >
                  回复
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}

      {hasMore ? (
        <button
          className="content-comments-load-more"
          disabled={loadingMore}
          onClick={() => void loadComments(cursor)}
          type="button"
        >
          {loadingMore ? '加载中…' : '加载更多评论'}
        </button>
      ) : null}
    </section>
  )
}
