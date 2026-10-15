import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import React from 'react'

import { enforcePublicReadRateLimit } from '@/auth/traffic-limit'
import { getBetterAuthPrincipal } from '@/auth/w02-session-client'

import CreatorLanguageToggle from './creator-center/CreatorLanguageToggle'
import { CreatorStudio } from './creator-center/CreatorStudio'
import HomeContentFeed from './HomeContentFeed'
import { GET as getPublicContents } from '../api/v1/contents/route'
import PublicLanguageToggle from './i18n/PublicLanguageToggle'
import { getPublicCopy, normalizePublicLocale, type PublicLocale } from './i18n/public-locale'
import './styles.css'

const CREATOR_CENTER_URL = 'https://mp.luckread.com/'
const CREATOR_CENTER_HOSTS = new Set(['mp.luckread.com'])

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

type InitialHomeContentItem = {
  id: string
  slug?: string
  contentType: 'article' | 'post' | 'video'
  title: string
  mediaRefs?: string[]
  coverRef?: string | null
  updatedAt?: string
}

type InitialHomeContentResponse = {
  data?: { items?: InitialHomeContentItem[] }
}

async function loadInitialHomeContent(requestHeaders: Headers): Promise<InitialHomeContentItem[] | undefined> {
  const publicHeaders = new Headers()
  const acceptLanguage = requestHeaders.get('accept-language')
  const clientIp = requestHeaders.get('cf-connecting-ip')
  if (acceptLanguage) publicHeaders.set('accept-language', acceptLanguage)
  if (clientIp) publicHeaders.set('cf-connecting-ip', clientIp)

  try {
    const request = new Request('https://luckread.com/api/v1/contents?limit=6', {
      headers: publicHeaders,
    })
    const response = await getPublicContents(request)
    if (!response.ok) return undefined
    const data = await response.json().catch((): null => null) as InitialHomeContentResponse | null
    return Array.isArray(data?.data?.items) ? data.data.items : undefined
  } catch {
    return undefined
  }
}

const categoriesByLocale: Record<PublicLocale, string[]> = {
  zh: ['图文', '视频', '动态', '专栏', '创作者'],
  en: ['Articles', 'Video', 'Posts', 'Columns', 'Creators'],
  tw: ['圖文', '影片', '動態', '專欄', '創作者'],
}

export default async function HomePage() {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('host') || '').split(':')[0].toLowerCase()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const publicLocale = normalizePublicLocale(localeCookie)
  const copy = getPublicCopy(publicLocale)

  if (CREATOR_CENTER_HOSTS.has(host)) {
    const request = new Request('https://mp.luckread.com/', { headers: requestHeaders })
    let principal: Awaited<ReturnType<typeof getBetterAuthPrincipal>> | null = null
    try {
      await enforcePublicReadRateLimit(request)
      principal = await getBetterAuthPrincipal(request)
    } catch {}
    if (principal?.active) {
      const displayName =
        typeof principal.username === 'string' && principal.username.trim()
          ? principal.username
          : principal.email
      return <CreatorStudio displayName={displayName} userId={principal.userId} locale={locale} />
    }
  }

  if (CREATOR_CENTER_HOSTS.has(host)) {
    return (
      <div className="mp-entry-shell">
        <header className="mp-entry-header">
          <Link className="mp-entry-brand" href="/" aria-label={locale === 'en-US' ? 'LuckRead Creator Studio home' : 'LuckRead 创作者中心首页'}>
            <span className="mp-entry-brand-mark">L</span>
            <span>LuckRead Creator Studio</span>
          </Link>
          <div className="mp-entry-header-tools">
            <span className="mp-entry-domain">mp.luckread.com</span>
            <CreatorLanguageToggle locale={locale} />
          </div>
        </header>
        <main className="mp-entry-main">
          <section className="mp-entry-copy" aria-labelledby="mp-entry-title">
            <span className="mp-entry-kicker">CREATOR WORKSPACE</span>
            <h1 id="mp-entry-title">创作、管理、运营，<strong>一站完成。</strong></h1>
            <p>{locale === 'en-US' ? 'Sign in to LuckRead Creator Studio to publish articles, posts, and videos, and manage content, review, media, and audience relationships.' : '登录 LuckRead 账号后进入创作者工作台，直接发布文章、动态和视频，并管理内容、审核、素材与粉丝关系。'}</p>
            <div className="mp-entry-actions">
              <Link className="mp-entry-primary" href="/login?returnTo=%2F">{locale === 'en-US' ? 'Sign in to Creator Studio' : '登录并进入创作者中心'}</Link>
              <Link className="mp-entry-secondary" href="/creator-center">{locale === 'en-US' ? 'Open creator center' : '进入兼容入口'}</Link>
            </div>
          </section>
          <section className="mp-entry-preview" aria-label="创作者工作台预览">
            <aside className="mp-entry-sidebar">
              <div className="mp-entry-mini-logo">LR</div>
              <span>工作台</span>
              <span className="active">首页</span>
              <span>创作</span>
              <span>内容管理</span>
              <span>数据中心</span>
              <span>粉丝与关注</span>
              <span>设置</span>
            </aside>
            <div className="mp-entry-dashboard">
              <div className="mp-entry-dashboard-top">
                <div><small>CREATOR DASHBOARD</small><strong>欢迎来到 LuckRead</strong></div>
                <span>发布内容</span>
              </div>
              <div className="mp-entry-create-row">
                <div><b>文章</b><small>图文与长文</small></div>
                <div><b>动态</b><small>短内容分享</small></div>
                <div><b>视频</b><small>视频内容</small></div>
              </div>
              <div className="mp-entry-stat-row">
                <div><small>内容</small><b>作品管理</b></div>
                <div><small>质量</small><b>发布检测</b></div>
                <div><small>运营</small><b>粉丝关系</b></div>
              </div>
            </div>
          </section>
        </main>
      </div>
    )
  }

  const initialHomeContent = await loadInitialHomeContent(requestHeaders)

  return (
    <div className="home-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label={copy.common.home}>
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-name">LuckRead</span>
        </Link>
        <nav className="site-nav" aria-label={copy.common.home}>
          <a className="nav-link nav-link-active" href="#top">{copy.common.home}</a>
          <Link className="nav-link" data-umami-event="content-discovery-open" href="/content">{copy.common.discover}</Link>
          <a className="nav-link" href="#creator">{copy.common.creators}</a>
          <a className="nav-link" href="#about">{copy.common.about}</a>
        </nav>
        <div className="header-actions">
          <Link className="header-login" href="/me/profile">{copy.common.profile}</Link>
          <Link className="header-login" href="/me/subscriptions">{copy.common.subscriptions}</Link>
          <Link className="header-login" href="/login">{copy.common.login}</Link>
          <PublicLanguageToggle locale={publicLocale} />
          <Link className="header-creator" data-umami-event="creator-center-open" href={CREATOR_CENTER_URL}>{copy.common.creatorCenter}</Link>
        </div>
      </header>

      <main id="top" className="home-main">
        <div className="home-reading-layout">
          <nav className="home-left-rail" aria-label={copy.common.home}>
            <Link
              className="home-rail-link home-rail-tree"
              data-umami-event="content-discovery-open"
              href="/content"
              aria-label={publicLocale === 'en' ? 'Threaded discussions' : publicLocale === 'tw' ? '樹狀討論' : '树形讨论'}
              title={publicLocale === 'en' ? 'Threaded discussions' : publicLocale === 'tw' ? '樹狀討論' : '树形讨论'}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <path d="M12 4v5M12 9H6v4M12 9h6v4" />
                <circle cx="12" cy="3.5" r="1.7" />
                <circle cx="6" cy="15.5" r="1.7" />
                <circle cx="18" cy="15.5" r="1.7" />
              </svg>
              <span className="home-sr-only">{publicLocale === 'en' ? 'Threaded discussions' : publicLocale === 'tw' ? '樹狀討論' : '树形讨论'}</span>
            </Link>
            <span className="home-rail-divider" aria-hidden="true" />
            <Link className="home-rail-link home-rail-active" href="/" aria-label={copy.common.home} title={copy.common.home}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2z" />
              </svg>
            </Link>
            <Link className="home-rail-link" href="/content" aria-label={copy.common.discover} title={copy.common.discover}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <circle cx="10.8" cy="10.8" r="6.8" />
                <path d="m16 16 4.2 4.2" />
              </svg>
            </Link>
            <Link className="home-rail-link" data-umami-event="short-video-discovery-open" href="/shorts" aria-label={publicLocale === 'en' ? 'Short videos' : publicLocale === 'tw' ? '短影片' : '短视频'} title={publicLocale === 'en' ? 'Short videos' : publicLocale === 'tw' ? '短影片' : '短视频'}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <rect x="3.5" y="5" width="17" height="14" rx="3" />
                <path d="m10 9 5 3-5 3z" />
              </svg>
            </Link>
            <Link className="home-rail-link" data-umami-event="creator-center-open" href={CREATOR_CENTER_URL} aria-label={copy.common.creatorCenter} title={copy.common.creatorCenter}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
                <path d="m14 5 5 5M4 20l4.2-.9L19 8.3a2.1 2.1 0 0 0-3-3L5.2 16.1z" />
                <path d="M4 20h16" />
              </svg>
            </Link>
          </nav>

          <div className="home-reading-main">
            <section className="hero home-feed-hero" aria-labelledby="hero-title">
              <div className="hero-copy">
                <p className="eyebrow">{copy.home.heroEyebrow}</p>
                <h1 id="hero-title">
                  {copy.home.heroTitle.split('<accent>')[0]}<span>{copy.home.heroTitle.split('<accent>')[1]}</span>
                </h1>
                <p className="hero-lede">
                  {copy.home.heroLead.split('\n')[0]}
                  <br className="desktop-break" />
                  {copy.home.heroLead.split('\n')[1]}
                </p>
                <div className="hero-actions">
                  <Link className="button button-primary" data-umami-event="creator-center-open" href={CREATOR_CENTER_URL}>{copy.common.createNow}<span aria-hidden="true">↗</span></Link>
                  <Link className="button button-quiet" data-umami-event="content-discovery-open" href="/content">{copy.common.explore}</Link>
                  <Link className="button button-quiet" data-umami-event="short-video-discovery-open" href="/shorts">{publicLocale === 'en' ? 'Short videos' : publicLocale === 'tw' ? '短影片' : '短视频'}</Link>
                </div>
              </div>
            </section>

            <nav className="home-topic-strip" aria-label={copy.home.categoryAria}>
              {categoriesByLocale[publicLocale].map((category, index) => (
                <Link
                  className="home-topic-link"
                  data-umami-event="content-discovery-open"
                  href={index === 1 ? '/shorts' : '/content'}
                  key={category}
                >
                  {category}<span aria-hidden="true">↗</span>
                </Link>
              ))}
            </nav>

            <HomeContentFeed locale={publicLocale} initialItems={initialHomeContent} />

            <section className="highlight-grid home-highlight-grid" aria-label={copy.home.highlightAria}>
              {copy.home.highlight.map((item, index) => (
                <article className="highlight-card" key={String(index + 1)}>
                  <div className="highlight-index">{String(index + 1).padStart(2, '0')}</div>
                  <p className="card-eyebrow">{item.eyebrow}</p>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <span className="card-arrow" aria-hidden="true">↗</span>
                </article>
              ))}
            </section>
          </div>

          <aside className="home-right-rail" aria-label={publicLocale === 'en' ? 'Creator and discovery' : publicLocale === 'tw' ? '創作與探索' : '创作与发现'}>
            <section className="home-side-card home-side-creator">
              <p className="eyebrow">FOR CREATORS</p>
              <h2 dangerouslySetInnerHTML={{ __html: copy.home.creatorTitle }} />
              <p>{copy.home.creatorDescription}</p>
              <Link className="button button-primary home-side-cta" data-umami-event="creator-center-open" href={CREATOR_CENTER_URL}>
                {copy.home.creatorCenter}<span aria-hidden="true">↗</span>
              </Link>
            </section>
            <section className="home-side-card">
              <h2>{publicLocale === 'en' ? 'Explore LuckRead' : publicLocale === 'tw' ? '探索 LuckRead' : '发现 LuckRead'}</h2>
              <nav className="home-side-links" aria-label={copy.common.discover}>
                <Link data-umami-event="content-discovery-open" href="/content">{copy.common.discover}<span aria-hidden="true">↗</span></Link>
                <Link data-umami-event="short-video-discovery-open" href="/shorts">{publicLocale === 'en' ? 'Short videos' : publicLocale === 'tw' ? '短影片' : '短视频'}<span aria-hidden="true">↗</span></Link>
                <Link href="/me/subscriptions">{copy.common.subscriptions}<span aria-hidden="true">↗</span></Link>
              </nav>
              <div className="home-side-tags">
                {categoriesByLocale[publicLocale].map((category, index) => (
                  <Link key={category} href={index === 1 ? '/shorts' : '/content'}>{category}</Link>
                ))}
              </div>
            </section>
            <section className="home-side-note">
              <h2>{publicLocale === 'en' ? 'Great discussions start with good content.' : publicLocale === 'tw' ? '好的討論，從好內容開始。' : '好的讨论，从好内容开始。'}</h2>
              <p>{publicLocale === 'en' ? 'Open any work to read replies and join the existing threaded discussion.' : publicLocale === 'tw' ? '打開任一作品，即可閱讀回覆並加入樹狀討論。' : '打开任一作品，即可阅读回复并参与树状讨论。'}</p>
              <Link data-umami-event="content-discovery-open" href="/content">{publicLocale === 'en' ? 'Enter discussions' : publicLocale === 'tw' ? '进入討論' : '进入讨论'} ↗</Link>
            </section>
          </aside>
        </div>
      </main>

      <footer className="site-footer" id="about">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div><strong>LuckRead</strong><span>{copy.home.footerTagline}</span></div>
        </div>
        <p>{copy.home.footerDescription}</p>
        <span className="footer-note">© LuckRead</span>
      </footer>
    </div>
  )
}
