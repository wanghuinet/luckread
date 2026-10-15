import Link from 'next/link'
import { headers } from 'next/headers'
import { GET as getPublicContents } from '../../api/v1/contents/route'
import TwitterCloneHomeFeed, { type HomeContentPage } from '../TwitterCloneHomeFeed'
import { TwitterLogo } from '../TwitterCloneLanding'

export const dynamic = 'force-dynamic'

async function loadInitialContent(requestHeaders: Headers): Promise<HomeContentPage> {
  const forwarded = new Headers({ accept: 'application/json' })
  const language = requestHeaders.get('accept-language')
  const ip = requestHeaders.get('cf-connecting-ip')
  if (language) forwarded.set('accept-language', language)
  if (ip) forwarded.set('cf-connecting-ip', ip)
  const request = new Request('https://luckread.com/api/v1/contents?limit=20', { headers: forwarded })
  try {
    // The contents route owns anonymous read rate limiting; do not count this request twice.
    const response = await getPublicContents(request)
    if (!response.ok) return { items: [], nextCursor: null, hasMore: false }
    const payload = await response.json() as { data?: HomeContentPage }
    const page = payload?.data
    return { items: Array.isArray(page?.items) ? page.items : [], nextCursor: page?.nextCursor ?? null, hasMore: page?.hasMore === true }
  } catch { return { items: [], nextCursor: null, hasMore: false } }
}

function NavIcon({ name }: { name: 'home' | 'search' | 'users' | 'bookmark' | 'user' | 'video' | 'write' }) {
  const paths: Record<typeof name, string> = {
    home:'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z',
    search:'M10.5 3a7.5 7.5 0 1 0 4.7 13.35L21 22l1-1-5.8-5.8A7.5 7.5 0 0 0 10.5 3z',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7-7.8a4 4 0 0 1 0 7.6m1 4h1a4 4 0 0 1 4 4v1',
    bookmark:'M6 3h12v18l-6-4-6 4z',user:'M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    video:'M4 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm14 5 5-3v10l-5-3z',
    write:'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z'
  }
  return <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d={paths[name]} /></svg>
}

export default async function TwitterCloneHomePage() {
  const initialPage = await loadInitialContent(await headers())
  return <div className="min-h-screen bg-main-background text-light-primary dark:text-dark-primary">
    <div className="mx-auto flex min-h-screen w-full max-w-[1265px] justify-center gap-0 lg:gap-4">
      <header id="sidebar" className="flex w-0 shrink-0 transition-opacity duration-200 xs:w-20 md:w-24 lg:max-w-none xl:-mr-4 xl:w-full xl:max-w-xs">
        <div className="fixed bottom-0 z-20 flex w-full flex-col justify-between border-t border-light-border bg-main-background py-0 dark:border-dark-border xs:top-0 xs:h-full xs:w-auto xs:border-0 xs:bg-transparent xs:px-2 xs:py-3 xs:pt-2 md:px-4 xl:w-72">
          <section className="flex flex-col justify-center gap-2 xs:items-center xl:items-stretch">
            <h1 className="hidden xs:flex"><Link className="custom-button main-tab text-accent-blue dark:text-twitter-icon" href="/home" aria-label="LuckRead home"><TwitterLogo className="h-7 w-7" /></Link></h1>
            <nav className="flex items-center justify-around xs:flex-col xs:justify-center xl:block">
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/home"><NavIcon name="home" /><span className="hidden text-xl xl:inline">Home</span></Link>
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/content"><NavIcon name="search" /><span className="hidden text-xl xl:inline">Explore</span></Link>
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/me/followers"><NavIcon name="users" /><span className="hidden text-xl xl:inline">Connections</span></Link>
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/me/following"><NavIcon name="bookmark" /><span className="hidden text-xl xl:inline">Following</span></Link>
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/shorts"><NavIcon name="video" /><span className="hidden text-xl xl:inline">Videos</span></Link>
              <Link className="custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start" href="/me/profile"><NavIcon name="user" /><span className="hidden text-xl xl:inline">Profile</span></Link>
            </nav>
            <Link className="accent-tab absolute right-4 -translate-y-[72px] rounded-full bg-main-accent px-4 py-3 text-lg font-bold text-white outline-none transition hover:brightness-90 xs:static xs:translate-y-0 xl:w-11/12" href="/publish"><span className="flex items-center justify-center gap-2"><NavIcon name="write" /><span className="hidden xl:inline">Post</span></span></Link>
          </section>
          <Link className="hidden items-center gap-3 rounded-full p-3 transition hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:flex" href="/me/profile"><span className="grid h-10 w-10 place-items-center rounded-full bg-main-sidebar-background font-bold">L</span><span className="grid min-w-0"><strong className="truncate text-sm">LuckRead</strong><small className="text-light-secondary dark:text-dark-secondary">Profile and settings</small></span></Link>
        </div>
      </header>
      <main className="hover-animation flex min-h-screen w-full max-w-xl flex-col border-x border-light-border pb-32 dark:border-dark-border xs:pb-96">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-6 bg-main-background/60 px-4 py-2 backdrop-blur-md"><h1 className="text-xl font-bold">Home</h1><Link className="text-sm font-bold text-main-accent hover:underline" href="/content">Explore all</Link></header>
        <nav className="grid grid-cols-2 border-b border-light-border dark:border-dark-border"><Link className="main-tab relative flex min-h-14 items-center justify-center font-bold hover:bg-white/5" href="/home">For you<span className="absolute bottom-0 h-1 w-14 rounded-full bg-main-accent" /></Link><Link className="main-tab flex min-h-14 items-center justify-center text-light-secondary hover:bg-white/5 dark:text-dark-secondary" href="/me/following">Following</Link></nav>
        <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 border-b border-light-border px-4 py-3 dark:border-dark-border"><span className="row-span-2 grid h-12 w-12 place-items-center rounded-full bg-main-sidebar-background text-lg font-bold">L</span><Link className="main-tab min-h-12 rounded-xl px-1 py-3 text-left text-xl text-light-secondary hover:bg-white/5 dark:text-dark-secondary" href="/publish">What is happening?!</Link><div className="col-start-2 flex justify-end pt-2"><Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white transition hover:brightness-90" href="/publish">Post</Link></div></div>
        <TwitterCloneHomeFeed initialPage={initialPage} />
      </main>
      <aside className="hidden w-96 shrink-0 flex-col gap-4 px-4 py-3 pt-1 lg:flex">
        <Link className="flex items-center gap-3 rounded-full bg-main-search-background px-4 py-3 text-light-secondary hover:ring-1 hover:ring-main-accent dark:text-dark-secondary" href="/content"><NavIcon name="search" /><span>Search LuckRead</span></Link>
        <section className="rounded-2xl bg-main-sidebar-background p-4"><h2 className="mb-4 text-xl font-bold">What to explore</h2><Link className="flex justify-between border-b border-light-border py-3 text-sm dark:border-dark-border" href="/content">Articles and discussions <span>›</span></Link><Link className="flex justify-between border-b border-light-border py-3 text-sm dark:border-dark-border" href="/shorts">Short videos <span>›</span></Link><Link className="flex justify-between border-b border-light-border py-3 text-sm dark:border-dark-border" href="/me/following">Following and creators <span>›</span></Link><Link className="flex justify-between py-3 text-sm" href="/me/subscriptions">Subscriptions <span>›</span></Link></section>
        <section className="rounded-2xl bg-main-sidebar-background p-4"><h2 className="mb-3 text-xl font-bold">For creators</h2><p className="mb-4 text-sm leading-relaxed text-light-secondary dark:text-dark-secondary">Publish articles, posts, and videos from the existing LuckRead creator workflow.</p><Link className="inline-flex rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white" href="/creator-center">Open Creator Studio</Link></section>
        <p className="px-2 text-xs leading-relaxed text-light-secondary dark:text-dark-secondary">LuckRead account, content, social, and subscription actions stay connected to the existing APIs.</p>
      </aside>
    </div>
  </div>
}
