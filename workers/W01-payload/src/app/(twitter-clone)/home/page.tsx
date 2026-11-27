import Link from 'next/link'
import { Suspense } from 'react'
import { cookies, headers } from 'next/headers'
import { fetchJson } from '../../../lib/client-api.js'
import TwitterCloneHomeFeed, { type HomeContentPage, type HomeFeedMode } from '../TwitterCloneHomeFeed'
import TwitterCloneSecondaryPageLayout from '../TwitterCloneSecondaryPageLayout'
import { TwitterClonePostComposerTrigger } from '../TwitterClonePostComposerModal'
import { normalizePublicLocale, type PublicLocale } from '../../(frontend)/i18n/public-locale'
import { getTwitterCloneCopy } from '../twitter-clone-copy'

export const dynamic = 'force-dynamic'

async function loadInitialContent(requestHeaders: Headers, locale: PublicLocale): Promise<HomeContentPage> {
  const forwarded = new Headers({ accept: 'application/json' })
  const language = locale === 'en' ? 'en-US' : locale === 'tw' ? 'zh-TW' : 'zh-CN'
  const ip = requestHeaders.get('cf-connecting-ip')
  forwarded.set('accept-language', language)
  if (ip) forwarded.set('cf-connecting-ip', ip)
  const request = new Request('https://api.luckread.com/v1/contents?limit=20', { headers: forwarded, cache: 'no-store' })
  try {
    const { response, data: payload } = await fetchJson<{ data?: HomeContentPage }>(request)
    const page = payload?.data
    if (!response.ok || !page || !Array.isArray(page.items)) {
      return { items: [], nextCursor: null, hasMore: false, initialLoadError: true }
    }
    return { items: page.items, nextCursor: page.nextCursor ?? null, hasMore: page.hasMore === true }
  } catch {
    return { items: [], nextCursor: null, hasMore: false, initialLoadError: true }
  }
}

function FeedFallback({ locale }: { locale: PublicLocale }) {
  const label = locale === 'en' ? 'Loading timeline…' : locale === 'tw' ? '載入動態…' : '正在加载动态…'
  return <div aria-label={label} aria-busy="true" className="divide-y divide-light-border dark:divide-dark-border">
    {Array.from({ length: 5 }, (_, index) => <div className="animate-pulse px-4 py-5" key={index}>
      <div className="flex gap-3"><span className="h-12 w-12 shrink-0 rounded-full bg-light-line-reply dark:bg-dark-border" /><div className="min-w-0 flex-1"><div className="h-3 w-1/3 rounded bg-light-line-reply dark:bg-dark-border" /><div className="mt-3 h-3 w-2/3 rounded bg-light-line-reply dark:bg-dark-border" /><div className="mt-3 h-3 w-full rounded bg-light-line-reply dark:bg-dark-border" /><div className="mt-2 h-3 w-4/5 rounded bg-light-line-reply dark:bg-dark-border" /></div></div>
    </div>)}
    <p className="sr-only" role="status">{label}</p>
  </div>
}

async function HomeFeedContent({ feedMode, locale }: { feedMode: HomeFeedMode; locale: PublicLocale }) {
  const initialPage: HomeContentPage = feedMode === 'following'
    ? { items: [], nextCursor: null, hasMore: false }
    : await loadInitialContent(await headers(), locale)
  return <TwitterCloneHomeFeed key={feedMode} initialPage={initialPage} locale={locale} feedMode={feedMode} />
}

export default async function TwitterCloneHomePage({ searchParams }: { searchParams?: Promise<{ feed?: string | string[] }> } = {}) {
  const params = searchParams ? await searchParams : {}
  const feedMode: HomeFeedMode = params.feed === 'following' ? 'following' : 'for-you'
  const locale = normalizePublicLocale((await cookies()).get('luckread-ui-locale')?.value)
  const copy = getTwitterCloneCopy(locale)
  return <TwitterCloneSecondaryPageLayout locale={locale} title={copy.home.home} active="home">
    <nav className="grid grid-cols-2 border-b border-light-border dark:border-dark-border">
      <Link className={feedMode === 'for-you' ? "main-tab relative flex min-h-14 items-center justify-center font-bold hover:bg-white/5" : "main-tab flex min-h-14 items-center justify-center text-light-secondary hover:bg-white/5 dark:text-dark-secondary"} href="/home">{copy.home.forYou}{feedMode === 'for-you' ? <span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /> : null}</Link>
      <Link className={feedMode === 'following' ? "main-tab relative flex min-h-14 items-center justify-center font-bold hover:bg-white/5" : "main-tab flex min-h-14 items-center justify-center text-light-secondary hover:bg-white/5 dark:text-dark-secondary"} href="/home?feed=following">{copy.home.followingTab}{feedMode === 'following' ? <span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /> : null}</Link>
    </nav>
    <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 border-b border-light-border px-4 py-3 dark:border-dark-border"><span className="row-span-2 grid h-12 w-12 place-items-center rounded-full bg-main-sidebar-background text-lg font-bold">L</span><TwitterClonePostComposerTrigger className="main-tab min-h-12 rounded-xl px-1 py-3 text-left text-xl text-light-secondary hover:bg-white/5 dark:text-dark-secondary" ariaLabel={copy.home.composePlaceholder}>{copy.home.composePlaceholder}</TwitterClonePostComposerTrigger><div className="col-start-2 flex justify-end pt-2"><TwitterClonePostComposerTrigger className="rounded-full bg-main-accent px-5 py-2 font-bold text-white transition hover:brightness-90" ariaLabel={copy.home.post}>{copy.home.post}</TwitterClonePostComposerTrigger></div></div>
    <Suspense fallback={<FeedFallback locale={locale} />}>
      <HomeFeedContent feedMode={feedMode} locale={locale} />
    </Suspense>
  </TwitterCloneSecondaryPageLayout>
}
