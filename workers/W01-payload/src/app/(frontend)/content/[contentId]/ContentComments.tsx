'use client'

import { FormEvent, useEffect, useState } from 'react'

type CommentItem = {
  id: string
  contentId: string
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
  const [message, setMessage] = useState('')

  async function loadComments(nextCursor: string | null = null) {
    if (nextCursor) setLoadingMore(true)
    else setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (nextCursor) params.set('cursor', nextCursor)
      const response = await fetch(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/comments?' + params.toString(),
        { headers: { accept: 'application/json' }, cache: 'no-store' },
      )
      const data = await response.json().catch((): null => null)
      if (!response.ok || !data?.data) {
        throw new Error(data?.error?.message || '评论加载失败')
      }
      const page = data.data as CommentPage
      setComments((current) => nextCursor ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      setHasMore(page.hasMore)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '评论加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    void loadComments()
  }, [contentId])

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
          body: JSON.stringify({ body: body.trim() }),
        },
      )
      const data = await response.json().catch((): null => null)
      if (response.status === 401) {
        setMessage('请先登录后发表评论。')
        return
      }
      if (!response.ok || !data?.data) {
        setMessage(data?.error?.message || '评论提交失败，请稍后重试。')
        return
      }
      setComments((current) => [data.data as CommentItem, ...current])
      setBody('')
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
          placeholder="写下你的看法…"
          rows={4}
          value={body}
        />
        <div className="content-comment-form-actions">
          <span>{body.length}/10000</span>
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
                <time dateTime={comment.createdAt}>
                  {new Date(comment.createdAt).toLocaleString('zh-CN', { hour12: false })}
                </time>
              </header>
              <p>{comment.body}</p>
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
