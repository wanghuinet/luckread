import Link from 'next/link'
import type { ReactNode } from 'react'

import PublicLanguageToggle from '../(frontend)/i18n/PublicLanguageToggle'
import type { PublicLocale } from '../(frontend)/i18n/public-locale'
import TwitterClonePostComposerModal, { TwitterClonePostComposerTrigger } from './TwitterClonePostComposerModal'
import TwitterCloneSidebarProfile from './TwitterCloneSidebarProfile'
import { TwitterLogo } from './TwitterCloneLanding'

type PageNavKey = 'home' | 'explore' | 'notifications' | 'connections' | 'following' | 'bookmarks' | 'videos' | 'profile'

type Props = {
  locale: PublicLocale
  title: string
  active: PageNavKey
  children: ReactNode
}

const labels = (locale: PublicLocale) => ({
  home: locale === 'en' ? 'Home' : locale === 'tw' ? '首頁' : '首页',
  explore: locale === 'en' ? 'Explore' : locale === 'tw' ? '探索' : '发现',
  notifications: locale === 'en' ? 'Notifications' : '通知',
  connections: locale === 'en' ? 'Connections' : locale === 'tw' ? '關係' : '关系',
  following: locale === 'en' ? 'Following' : locale === 'tw' ? '追蹤中' : '关注中',
  bookmarks: locale === 'en' ? 'Bookmarks' : locale === 'tw' ? '書籤' : '收藏',
  videos: locale === 'en' ? 'Videos' : locale === 'tw' ? '影片' : '视频',
  profile: locale === 'en' ? 'Profile' : locale === 'tw' ? '個人主頁' : '个人主页',
  post: locale === 'en' ? 'Post' : locale === 'tw' ? '發布' : '发布',
  search: locale === 'en' ? 'Search LuckRead' : locale === 'tw' ? '搜尋 LuckRead' : '搜索 LuckRead',
  exploreContent: locale === 'en' ? 'Articles and discussions' : locale === 'tw' ? '文章與討論' : '文章与讨论',
  shorts: locale === 'en' ? 'Short videos' : locale === 'tw' ? '短影片' : '短视频',
  subscriptions: locale === 'en' ? 'Subscriptions' : locale === 'tw' ? '訂閱' : '订阅',
  forCreators: locale === 'en' ? 'For creators' : locale === 'tw' ? '創作者入口' : '创作者入口',
  creatorDescription: locale === 'en' ? 'Publish articles, posts, and videos through LuckRead.' : locale === 'tw' ? '透過 LuckRead 發布文章、動態和影片。' : '通过 LuckRead 发布文章、动态和视频。',
  openCreatorStudio: locale === 'en' ? 'Open Creator Studio' : locale === 'tw' ? '進入創作者中心' : '进入创作者中心',
})

function SidebarIcon({ name }: { name: 'home' | 'search' | 'users' | 'bookmark' | 'user' | 'video' | 'write' | 'bell' }) {
  const paths: Record<typeof name, string> = {
    home: 'M3 10.5 12 3l9 7.5V21h-6v-7H9v7H3z',
    search: 'M10.5 3a7.5 7.5 0 1 0 4.7 13.35L21 22l1-1-5.8-5.8A7.5 7.5 0 0 0 10.5 3z',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7-7.8a4 4 0 0 1 0 7.6m1 4h1a4 4 0 0 1 4 4v1',
    bookmark: 'M6 3h12v18l-6-4-6 4z',
    user: 'M20 21a8 8 0 0 0-16 0m8-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    video: 'M4 5h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm14 5 5-3v10l-5-3z',
    write: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  }
  return <svg aria-hidden="true" className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"><path d={paths[name]} /></svg>
}

export default function TwitterCloneSecondaryPageLayout({ locale, title, active, children }: Props) {
  const copy = labels(locale)
  const links: Array<{ key: PageNavKey; href: string; icon: Parameters<typeof SidebarIcon>[0]['name'] }> = [
    { key: 'home', href: '/home', icon: 'home' },
    { key: 'explore', href: '/content', icon: 'search' },
    { key: 'notifications', href: '/notifications', icon: 'bell' },
    { key: 'connections', href: '/me/followers', icon: 'users' },
    { key: 'following', href: '/me/following', icon: 'user' },
    { key: 'bookmarks', href: '/bookmarks', icon: 'bookmark' },
    { key: 'videos', href: '/shorts', icon: 'video' },
    { key: 'profile', href: '/me/profile', icon: 'user' },
  ]

  return (
    <div className="min-h-screen bg-main-background text-light-primary dark:text-dark-primary">
      <TwitterClonePostComposerModal />
      <div className="mx-auto flex min-h-screen w-full max-w-[1265px] justify-center gap-0 lg:gap-4">
        <header id="sidebar" className="flex w-0 shrink-0 transition-opacity duration-200 xs:w-20 md:w-24 lg:max-w-none xl:-mr-4 xl:w-full xl:max-w-xs">
          <div className="fixed bottom-0 z-20 flex w-full flex-col justify-between border-t border-light-border bg-main-background py-0 dark:border-dark-border xs:top-0 xs:h-full xs:w-auto xs:border-0 xs:bg-transparent xs:px-2 xs:py-3 xs:pt-2 md:px-4 xl:w-72">
            <section className="flex flex-col justify-center gap-2 xs:items-center xl:items-stretch">
              <h1 className="hidden xs:flex"><Link className="custom-button main-tab text-accent-blue dark:text-twitter-icon" href="/home" aria-label={copy.home}><TwitterLogo className="h-7 w-7" /></Link></h1>
              <nav className="flex items-center justify-around xs:flex-col xs:justify-center xl:block" aria-label={locale === 'en' ? 'Main navigation' : '主导航'}>
                {links.map((item) => (
                  <Link key={item.key} aria-current={active === item.key ? 'page' : undefined} className={'custom-button main-tab flex items-center gap-5 rounded-full hover:bg-light-primary/10 dark:hover:bg-dark-primary/10 xl:justify-start' + (active === item.key ? ' font-bold' : '')} data-umami-event={item.key === 'bookmarks' ? 'bookmarks-open' : undefined} href={item.href}>
                    <SidebarIcon name={item.icon} /><span className="hidden text-xl xl:inline">{copy[item.key]}</span>
                  </Link>
                ))}
              </nav>
              <TwitterClonePostComposerTrigger className="accent-tab absolute right-4 -translate-y-[72px] rounded-full bg-main-accent px-4 py-3 text-lg font-bold text-white outline-none transition hover:brightness-90 xs:static xs:translate-y-0 xl:w-11/12" ariaLabel={copy.post}>
                <span className="flex items-center justify-center gap-2"><SidebarIcon name="write" /><span className="hidden xl:inline">{copy.post}</span></span>
              </TwitterClonePostComposerTrigger>
            </section>
            <TwitterCloneSidebarProfile locale={locale} />
          </div>
        </header>
        <main className="hover-animation flex min-h-screen w-full max-w-xl flex-col border-x border-light-border pb-32 dark:border-dark-border xs:pb-96">
          <header className="sticky top-0 z-10 flex items-center justify-between gap-6 bg-main-background/60 px-4 py-3 backdrop-blur-md">
            <h1 className="text-xl font-bold">{title}</h1>
            <PublicLanguageToggle locale={locale} />
          </header>
          {children}
        </main>
        <aside className="hidden w-96 shrink-0 flex-col gap-4 px-4 py-3 pt-1 lg:flex">
          <Link className="flex items-center gap-3 rounded-full bg-main-search-background px-4 py-3 text-light-secondary hover:ring-1 hover:ring-main-accent dark:text-dark-secondary" href="/content"><SidebarIcon name="search" /><span>{copy.search}</span></Link>
          <section className="rounded-2xl bg-main-sidebar-background p-4">
            <h2 className="mb-4 text-xl font-bold">{locale === 'en' ? 'What to explore' : locale === 'tw' ? '探索內容' : '探索内容'}</h2>
            <Link className="flex justify-between border-b border-light-border py-3 text-sm dark:border-dark-border" href="/content">{copy.exploreContent}<span>›</span></Link>
            <Link className="flex justify-between border-b border-light-border py-3 text-sm dark:border-dark-border" href="/shorts">{copy.shorts}<span>›</span></Link>
            <Link className="flex justify-between py-3 text-sm" href="/me/subscriptions">{copy.subscriptions}<span>›</span></Link>
          </section>
          <section className="rounded-2xl bg-main-sidebar-background p-4">
            <h2 className="mb-3 text-xl font-bold">{copy.forCreators}</h2>
            <p className="mb-4 text-sm leading-relaxed text-light-secondary dark:text-dark-secondary">{copy.creatorDescription}</p>
            <Link className="inline-flex rounded-full bg-main-accent px-4 py-2 text-sm font-bold text-white" href="/creator-center">{copy.openCreatorStudio}</Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
