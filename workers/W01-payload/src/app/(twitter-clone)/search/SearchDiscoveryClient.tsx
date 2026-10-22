'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import type { PublicLocale } from '../../(frontend)/i18n/public-locale'

type SearchTrend = { term: string; count: number; lastSeenAt: string }
type SearchResult = {
  id: string
  slug?: string
  contentType?: 'article' | 'post' | 'video'
  title: string
  creatorId?: string | null
  createdAt?: string
}
type SearchPageData = { items: SearchResult[]; nextCursor: string | null; hasMore: boolean }
type Status = 'idle' | 'loading' | 'ready' | 'error'

const copy = (locale: PublicLocale) => locale === 'en'
  ? {
      title: 'What are you looking for?',
      placeholder: 'Search LuckRead',
      submit: 'Search',
      trending: 'Trending searches',
      trendingHint: 'Popular public search terms from this edge region',
      noTrends: 'No trending searches yet. Try searching for a topic.',
      trendUnavailable: 'Trending searches are temporarily unavailable.',
      results: 'Search results',
      empty: 'No public content matched this search.',
      enterQuery: 'Enter a search term to find public articles, posts, and videos.',
      loading: 'Searching…',
      error: 'Search is temporarily unavailable. Please try again.',
      article: 'Article',
      post: 'Post',
      video: 'Video',
      openContent: 'Open content',
      recentSearches: 'Search suggestions',
    }
  : locale === 'tw'
    ? {
        title: '你正在尋找什麼？',
        placeholder: '搜尋 LuckRead',
        submit: '搜尋',
        trending: '熱門搜尋',
        trendingHint: '此區域的公開熱門搜尋詞',
        noTrends: '目前還沒有熱門搜尋，試著搜尋一個主題吧。',
        trendUnavailable: '熱門搜尋暫時無法使用。',
        results: '搜尋結果',
        empty: '沒有找到符合條件的公開內容。',
        enterQuery: '輸入關鍵詞，搜尋公開文章、動態與影片。',
        loading: '搜尋中…',
        error: '搜尋暫時無法使用，請稍後再試。',
        article: '文章',
        post: '動態',
        video: '影片',
        openContent: '查看內容',
        recentSearches: '搜尋建議',
      }
    : {
        title: '你在寻找什么？',
        placeholder: '搜索 LuckRead',
        submit: '搜索',
        trending: '热门搜索',
        trendingHint: '当前边缘区域的公开热门搜索词',
        noTrends: '暂时还没有热门搜索，试试搜索一个话题吧。',
        trendUnavailable: '热门搜索暂时无法使用。',
        results: '搜索结果',
        empty: '没有找到匹配的公开内容。',
        enterQuery: '输入关键词，搜索公开文章、动态和视频。',
        loading: '搜索中…',
        error: '搜索暂时无法使用，请稍后重试。',
        article: '文章',
        post: '动态',
        video: '视频',
        openContent: '查看内容',
        recentSearches: '搜索建议',
      }

export default function SearchDiscoveryClient({
  locale,
  initialQuery,
}: {
  locale: PublicLocale
  initialQuery: string
}) {
  const router = useRouter()
  const labels = copy(locale)
  const [query, setQuery] = useState(initialQuery)
  const [trends, setTrends] = useState<SearchTrend[]>([])
  const [trendingStatus, setTrendingStatus] = useState<Status>('loading')
  const [results, setResults] = useState<SearchResult[]>([])
  const [resultStatus, setResultStatus] = useState<Status>(initialQuery ? 'loading' : 'idle')
  const [searchRetryToken, setSearchRetryToken] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setTrendingStatus('loading')
    fetch('/api/v1/search/trending?limit=10', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Trending search request failed')
      const payload = await response.json() as { data?: { items?: unknown[] } }
      const items = payload.data?.items
      if (!Array.isArray(items)) throw new Error('Invalid trending search response')
      setTrends(items.filter((item): item is SearchTrend =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as SearchTrend).term === 'string' &&
        typeof (item as SearchTrend).count === 'number' &&
        typeof (item as SearchTrend).lastSeenAt === 'string',
      ))
      setTrendingStatus('ready')
    }).catch(() => {
      if (!controller.signal.aborted) {
        setTrends([])
        setTrendingStatus('error')
      }
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const normalized = initialQuery.normalize('NFKC').trim()
    setQuery(normalized)
    if (!normalized) {
      setResults([])
      setResultStatus('idle')
      return
    }
    const controller = new AbortController()
    setResultStatus('loading')
    fetch('/api/v1/search?' + new URLSearchParams({ q: normalized, limit: '20' }).toString(), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error('Search request failed')
      const payload = await response.json() as { data?: SearchPageData }
      if (!payload.data || !Array.isArray(payload.data.items)) throw new Error('Invalid search response')
      setResults(payload.data.items.filter((item) =>
        Boolean(item) && typeof item.id === 'string' && typeof item.title === 'string',
      ))
      setResultStatus('ready')
    }).catch(() => {
      if (!controller.signal.aborted) {
        setResults([])
        setResultStatus('error')
      }
    })
    return () => controller.abort()
  }, [initialQuery, searchRetryToken])

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = query.normalize('NFKC').trim()
    if (!normalized || normalized.length > 256) return
    if (normalized === initialQuery) {
      setSearchRetryToken((token) => token + 1)
      return
    }
    router.push('/search?q=' + encodeURIComponent(normalized))
  }

  const openTrend = (term: string) => {
    setQuery(term)
    router.push('/search?q=' + encodeURIComponent(term))
  }

  const typeLabel = (type?: SearchResult['contentType']) =>
    type === 'article' ? labels.article : type === 'video' ? labels.video : labels.post

  return (
    <div className="flex flex-col">
      <section className="border-b border-light-border px-4 py-5 dark:border-dark-border">
        <h2 className="mb-4 text-xl font-bold">{labels.title}</h2>
        <form className="flex items-center gap-2" onSubmit={submitSearch} role="search">
          <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-main-search-background px-4 py-3">
            <svg aria-hidden="true" className="h-5 w-5 shrink-0 text-light-secondary dark:text-dark-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></svg>
            <input
              aria-label={labels.placeholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-light-secondary dark:placeholder:text-dark-secondary"
              maxLength={256}
              name="q"
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.placeholder}
              value={query}
            />
          </label>
          <button className="rounded-full bg-main-accent px-4 py-3 text-sm font-bold text-white transition hover:brightness-90 disabled:opacity-50" disabled={!query.trim() || query.trim().length > 256} type="submit">{labels.submit}</button>
        </form>
      </section>

      {!initialQuery ? (
        <section aria-labelledby="trending-search-title" className="border-b border-light-border dark:border-dark-border">
          <header className="px-4 py-4">
            <h2 className="text-xl font-bold" id="trending-search-title">{labels.trending}</h2>
            <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">{labels.trendingHint}</p>
          </header>
          {trendingStatus === 'loading' ? (
            <p className="px-4 pb-5 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</p>
          ) : trends.length === 0 ? (
            <p className="px-4 pb-5 text-sm text-light-secondary dark:text-dark-secondary" role="status">{trendingStatus === 'error' ? labels.trendUnavailable : labels.noTrends}</p>
          ) : (
            <ul>
              {trends.map((trend, index) => (
                <li key={trend.term} className="border-t border-light-border px-4 py-3 transition hover:bg-white/5 dark:border-dark-border">
                  <button className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-main-accent" onClick={() => openTrend(trend.term)} type="button">
                    <span className="block text-xs text-light-secondary dark:text-dark-secondary">{index + 1} · {labels.recentSearches}</span>
                    <span className="mt-1 block text-base font-bold">#{trend.term}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-labelledby="search-results-title">
          <header className="border-b border-light-border px-4 py-4 dark:border-dark-border">
            <h2 className="text-xl font-bold" id="search-results-title">{labels.results}</h2>
            <p className="mt-1 text-sm text-light-secondary dark:text-dark-secondary">“{initialQuery}”</p>
          </header>
          {resultStatus === 'loading' ? (
            <p className="px-4 py-8 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.loading}</p>
          ) : resultStatus === 'error' ? (
            <p className="px-4 py-8 text-sm text-light-secondary dark:text-dark-secondary" role="alert">{labels.error}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-8 text-sm text-light-secondary dark:text-dark-secondary" role="status">{labels.empty}</p>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={result.id} className="border-b border-light-border px-4 py-4 transition hover:bg-white/5 dark:border-dark-border">
                  <Link className="block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-main-accent" href={'/content/' + encodeURIComponent(result.slug || result.id)}>
                    <p className="text-xs text-light-secondary dark:text-dark-secondary">{typeLabel(result.contentType)}</p>
                    <h3 className="mt-1 text-base font-bold">{result.title}</h3>
                    <span className="mt-2 inline-block text-sm font-bold text-main-accent">{labels.openContent} ›</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) }
    </div>
  )
}
