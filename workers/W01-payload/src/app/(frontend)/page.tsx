import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import React from 'react'

import { enforcePublicReadRateLimit } from '@/auth/traffic-limit'
import { getBetterAuthSession } from '@/auth/better-auth'

import CreatorLanguageToggle from './creator-center/CreatorLanguageToggle'
import { CreatorStudio } from './creator-center/CreatorStudio'
import HomeContentFeed from './HomeContentFeed'
import PublicLanguageToggle from './i18n/PublicLanguageToggle'
import { getPublicCopy, normalizePublicLocale, type PublicLocale } from './i18n/public-locale'
import './styles.css'

const CREATOR_CENTER_URL = 'https://mp.luckread.com/'
const CREATOR_CENTER_HOSTS = new Set(['mp.luckread.com'])

export const dynamic = 'force-dynamic'

type StudioLocale = 'zh-CN' | 'en-US'

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
    const request = new Request('https://mp.luckread.com/', {
      headers: requestHeaders,
    })

    try {
      await enforcePublicReadRateLimit(request)
    } catch {
      // Keep the public creator entry available even when the anonymous
      // request-rate budget is exhausted.
    }

    const session = await getBetterAuthSession(request).catch(() => null)
    if (session?.user?.id) {
      const displayName =
        typeof session.user.displayName === 'string' && session.user.displayName.trim()
          ? session.user.displayName
          : typeof session.user.name === 'string' && session.user.name.trim()
            ? session.user.name
            : typeof session.user.email === 'string' && session.user.email.trim()
              ? session.user.email
              : '创作者'

      return <CreatorStudio displayName={displayName} userId={String(session.user.id)} locale={locale} />
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

  return (
    <div className="home-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label={copy.common.home}>
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-name">LuckRead</span>
        </Link>
        <nav className="site-nav" aria-label={copy.common.home}>
          <a className="nav-link nav-link-active" href="#top">{copy.common.home}</a>
          <Link className="nav-link" href="/content">{copy.common.discover}</Link>
          <a className="nav-link" href="#creator">{copy.common.creators}</a>
          <a className="nav-link" href="#about">{copy.common.about}</a>
        </nav>
        <div className="header-actions">
          <Link className="header-login" href="/me/profile">{copy.common.profile}</Link>
          <Link className="header-login" href="/me/subscriptions">{copy.common.subscriptions}</Link>
          <Link className="header-login" href="/login">{copy.common.login}</Link>
          <PublicLanguageToggle locale={publicLocale} />
          <Link className="header-creator" href={CREATOR_CENTER_URL}>{copy.common.creatorCenter}</Link>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
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
              <Link className="button button-primary" href={CREATOR_CENTER_URL}>{copy.common.createNow}<span aria-hidden="true">↗</span></Link>
              <Link className="button button-quiet" href="/content">{copy.common.explore}</Link>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="hero-orbit hero-orbit-one" />
            <div className="hero-orbit hero-orbit-two" />
            <div className="hero-panel">
              <div className="hero-panel-top"><span>LUCKREAD</span><span>01 / 03</span></div>
              <div className="hero-signal"><span className="signal-dot" /><span>CONTENT / CREATOR / VALUE</span></div>
              <div className="hero-panel-title">Good ideas deserve a wider world.</div>
              <div className="hero-panel-line" />
              <div className="hero-panel-meta"><span>文字</span><span>影像</span><span>观点</span></div>
            </div>
          </div>
        </section>

        <section className="category-strip" aria-label={copy.home.categoryAria}>
          {categoriesByLocale[publicLocale].map((category, index) => (
            <span className="category-item" key={category}>
              <span className="category-index">0{index + 1}</span>{category}
            </span>
          ))}
        </section>

        <section className="intro-section" id="explore">
          <div className="section-heading">
            <p className="eyebrow">{copy.home.exploreEyebrow}</p>
            <h2 dangerouslySetInnerHTML={{ __html: copy.home.exploreTitle }} />
          </div>
          <p className="section-description">{copy.home.exploreDescription}</p>
        </section>

        <HomeContentFeed locale={publicLocale} />

        <section className="highlight-grid" aria-label={copy.home.highlightAria}>
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

        <section className="creator-banner" id="creator">
          <div>
            <p className="eyebrow">{copy.home.creatorEyebrow}</p>
            <h2 dangerouslySetInnerHTML={{ __html: copy.home.creatorTitle }} />
          </div>
          <div className="creator-banner-side">
            <p>{copy.home.creatorDescription}</p>
            <Link className="button button-light" href={CREATOR_CENTER_URL}>{copy.home.creatorCenter}<span aria-hidden="true">↗</span></Link>
          </div>
        </section>
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
