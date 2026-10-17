'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../../../lib/client-api.js'
import type { PublicLocale } from '../../i18n/public-locale'

type PollOption = {
  optionId: string
  text: string
  position: number
  votes: number
}

type Poll = {
  pollId: string
  contentId: string
  options: PollOption[]
  durationHours: 24 | 72 | 168
  endsAt: string | null
  totalVotes: number
  viewerOptionId: string | null
  closed: boolean
}

type ApiResponse<T> = { data?: T; error?: { message?: string } }

const labels = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'Poll',
      vote: 'Vote',
      voting: 'Voting…',
      votes: 'votes',
      choose: 'Choose an option first.',
      closed: 'Poll closed',
      ends: 'Poll ends',
      login: 'Sign in to vote',
      failed: 'Could not load poll.',
    }
  : locale === 'tw'
    ? {
        title: '投票',
        vote: '投票',
        voting: '投票中…',
        votes: '票',
        choose: '請先選擇一個選項。',
        closed: '投票已結束',
        ends: '截止時間',
        login: '登入後投票',
        failed: '暫時無法載入投票。',
      }
    : {
        title: '投票',
        vote: '投票',
        voting: '投票中…',
        votes: '票',
        choose: '请先选择一个选项。',
        closed: '投票已结束',
        ends: '截止时间',
        login: '登录后投票',
        failed: '暂时无法加载投票。',
      }

export default function SocialPoll({ contentId, locale = 'zh' }: { contentId: string; locale?: PublicLocale }) {
  const [poll, setPoll] = useState<Poll | null>(null)
  const [selectedOptionId, setSelectedOptionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [requiresLogin, setRequiresLogin] = useState(false)
  const [message, setMessage] = useState('')
  const text = labels(locale)
  const dateLocale = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const returnTo = '/content/' + encodeURIComponent(contentId)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    const load = async () => {
      try {
        const { response, data } = await fetchJson<ApiResponse<{ poll?: Poll | null }>>(
          '/api/v1/contents/' + encodeURIComponent(contentId) + '/poll',
          { credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { accept: 'application/json' } },
        )
        if (cancelled) return
        if (!response.ok || !data?.data) return
        const value = data.data.poll ?? null
        setPoll(value)
        setSelectedOptionId(value?.viewerOptionId ?? '')
      } catch {
        if (!cancelled) setMessage(text.failed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [contentId, text.failed])

  async function vote() {
    if (!poll || busy || poll.closed || poll.viewerOptionId) return
    if (!selectedOptionId) {
      setMessage(text.choose)
      return
    }
    setBusy(true)
    setMessage('')
    setRequiresLogin(false)
    try {
      const { response, data } = await fetchJson<ApiResponse<{ poll?: Poll }>>(
        '/api/v1/contents/' + encodeURIComponent(contentId) + '/poll/votes',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Idempotency-Key': 'social-poll-vote:' + contentId + ':' + crypto.randomUUID(),
          },
          body: JSON.stringify({ optionId: selectedOptionId }),
        },
      )
      if (response.status === 401) {
        setRequiresLogin(true)
        setMessage('')
        return
      }
      if (!response.ok || !data?.data?.poll) {
        throw new Error(getApiErrorMessage(data, locale === 'en' ? 'Vote failed.' : '投票失败，请稍后重试。'))
      }
      setPoll(data.data.poll)
      setSelectedOptionId(data.data.poll.viewerOptionId ?? selectedOptionId)
      setMessage('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : text.failed)
    } finally {
      setBusy(false)
    }
  }

  if (loading || !poll) return null
  const showResults = Boolean(poll.viewerOptionId || poll.closed)
  const endsAt = poll.endsAt && Number.isFinite(Date.parse(poll.endsAt))
    ? new Date(poll.endsAt).toLocaleString(dateLocale)
    : null

  return (
    <section className="my-3 rounded-2xl border border-light-border p-3 dark:border-dark-border" aria-label={text.title}>
      <h3 className="mb-3 text-sm font-bold">{text.title}</h3>
      <div className="flex flex-col gap-2">
        {poll.options.map((option) => {
          const percentage = poll.totalVotes > 0 ? Math.round(option.votes / poll.totalVotes * 100) : 0
          const isSelected = selectedOptionId === option.optionId
          const isViewerVote = poll.viewerOptionId === option.optionId
          return (
            <div key={option.optionId}>
              {showResults ? (
                <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{option.text}{isViewerVote ? ' ✓' : ''}</span>
                  <span className="shrink-0 text-light-secondary dark:text-dark-secondary">{percentage}% · {option.votes} {text.votes}</span>
                </div>
              ) : (
                <button
                  type="button"
                  className={'w-full rounded-full border px-3 py-2 text-left text-sm font-semibold transition ' + (isSelected ? 'border-main-accent bg-main-accent/10' : 'border-light-border hover:bg-light-primary/10 dark:border-dark-border dark:hover:bg-dark-primary/10')}
                  aria-pressed={isSelected}
                  disabled={busy || poll.closed}
                  onClick={() => { setSelectedOptionId(option.optionId); setMessage('') }}
                >
                  {option.text}
                </button>
              )}
              {showResults ? (
                <div className="h-1.5 overflow-hidden rounded-full bg-light-border dark:bg-dark-border" aria-hidden="true">
                  <div className="h-full rounded-full bg-main-accent" style={{ width: percentage + '%' }} />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-light-secondary dark:text-dark-secondary">
        <span>{poll.totalVotes.toLocaleString(dateLocale)} {text.votes}</span>
        {poll.closed
          ? <span>{text.closed}</span>
          : endsAt ? <time dateTime={poll.endsAt ?? undefined}>{text.ends}: {endsAt}</time> : null}
      </div>
      {!showResults && !poll.closed ? (
        <div className="mt-3">
          <button type="button" className="rounded-full bg-main-accent px-5 py-2 text-sm font-bold text-white disabled:opacity-50" disabled={busy || !selectedOptionId} onClick={() => void vote()}>
            {busy ? text.voting : text.vote}
          </button>
        </div>
      ) : null}
      {requiresLogin ? (
        <p className="mt-2 text-sm"><Link className="font-bold text-main-accent underline" href={'/login?returnTo=' + encodeURIComponent(returnTo)}>{text.login}</Link></p>
      ) : null}
      {message ? <p className="mt-2 text-sm" role="status">{message}</p> : null}
    </section>
  )
}
