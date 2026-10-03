import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import React from 'react'

import config from '@payload-config'

import { enforcePublicReadRateLimit } from '@/auth/traffic-limit'
import { readVerifiedPayloadTokenVersion } from '@/auth/payload-access-token'
import { validateSession } from '@/auth/w02-session-client'

import HomeContentFeed from './HomeContentFeed'
import './styles.css'

const CREATOR_CENTER_URL = 'https://mp.luckread.com/'
const CREATOR_CENTER_HOSTS = new Set(['mp.luckread.com', 'mp.luckread.cn'])

export const dynamic = 'force-dynamic'

const highlights = [
  { index: '01', eyebrow: '发现', title: '从日常阅读，到更广阔的世界', body: '汇聚图文、视频与深度内容，让每一次停留都有值得带走的东西。' },
  { index: '02', eyebrow: '创作', title: '让每一种表达，都有被看见的机会', body: '一个创作者中心，覆盖文章、动态与视频发布，轻装上阵，持续创作。' },
  { index: '03', eyebrow: '连接', title: '让人与内容，形成长期的价值连接', body: '从公开分享，到订阅与专业服务，建立更有温度、更有秩序的内容生态。' },
]
const categories = ['图文', '视频', '动态', '专栏', '创作者']

export default async function HomePage() {
  const requestHeaders = await headers()
  const host = (requestHeaders.get('host') || '').split(':')[0].toLowerCase()

  if (CREATOR_CENTER_HOSTS.has(host)) {
    const request = new Request('https://mp.luckread.com/', {
      headers: requestHeaders,
    })
    const authorization = request.headers.get('authorization')?.trim() || ''
    const hasPayloadTokenCookie = request.headers.get('cookie')?.split(';').some((part) => {
      const [name, ...value] = part.trim().split('=')
      return name === 'payload-token' && value.join('=').trim().length > 0
    }) === true
    const hasAuthCredential =
      authorization.startsWith('Bearer ') ||
      hasPayloadTokenCookie

    let authenticatedUser: {
      id?: string | number
      _sid?: string
    } | null = null

    if (hasAuthCredential) {
      let edgeReadAllowed = true
      try {
        await enforcePublicReadRateLimit(request)
      } catch {
        edgeReadAllowed = false
      }

      if (edgeReadAllowed) {
        try {
          const payload = await getPayload({ config })
          const authResult = await payload.auth({
            headers: request.headers,
            canSetHeaders: false,
          })
          authenticatedUser = authResult.user as unknown as {
            id?: string | number
            _sid?: string
          } | null
        } catch {
          authenticatedUser = null
        }
      }
    }

    if (authenticatedUser?.id && typeof authenticatedUser._sid === 'string' && authenticatedUser._sid) {
      const tokenVersion = readVerifiedPayloadTokenVersion(request)
      if (tokenVersion !== null) {
        const active = await validateSession({
          sessionId: authenticatedUser._sid,
          userId: String(authenticatedUser.id),
          tokenVersion,
        }).catch(() => false)

        if (active) {
          redirect('/creator-center')
        }
      }
    }
  }

  return (
    <div className="home-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="LuckRead 首页">
          <span className="brand-mark" aria-hidden="true">L</span>
          <span className="brand-name">LuckRead</span>
        </Link>
        <nav className="site-nav" aria-label="主导航">
          <a className="nav-link nav-link-active" href="#top">首页</a>
          <Link className="nav-link" href="/content">发现</Link>
          <a className="nav-link" href="#creator">创作者</a>
          <a className="nav-link" href="#about">关于 LuckRead</a>
        </nav>
        <div className="header-actions">
          <Link className="header-login" href="/me/profile">我的资料</Link>
          <Link className="header-login" href="/me/subscriptions">我的订阅</Link>
          <Link className="header-login" href="/login">登录</Link>
          <Link className="header-creator" href={CREATOR_CENTER_URL}>创作者中心</Link>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">发现 · 创作 · 连接</p>
            <h1 id="hero-title">让好内容<span>被看见</span></h1>
            <p className="hero-lede">
              LuckRead 是面向新一代创作者与读者的内容平台。
              <br className="desktop-break" />
              在这里，阅读获得启发，表达创造价值，人与人因内容相遇。
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href={CREATOR_CENTER_URL}>立即创作<span aria-hidden="true">↗</span></Link>
              <Link className="button button-quiet" href="/content">探索内容</Link>
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

        <section className="category-strip" aria-label="内容类型">
          {categories.map((category, index) => (
            <span className="category-item" key={category}>
              <span className="category-index">0{index + 1}</span>{category}
            </span>
          ))}
        </section>

        <section className="intro-section" id="explore">
          <div className="section-heading">
            <p className="eyebrow">A place for better content</p>
            <h2>不追逐喧嚣，<br />更在意内容本身。</h2>
          </div>
          <p className="section-description">
            我们希望把首页做成一扇安静而有力量的门：打开得快，读起来舒服，
            让真正有价值的观点、经验与作品，在更合适的场景里被发现。
          </p>
        </section>

        <HomeContentFeed />

        <section className="highlight-grid" aria-label="平台价值">
          {highlights.map((item) => (
            <article className="highlight-card" key={item.index}>
              <div className="highlight-index">{item.index}</div>
              <p className="card-eyebrow">{item.eyebrow}</p>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className="card-arrow" aria-hidden="true">↗</span>
            </article>
          ))}
        </section>

        <section className="creator-banner" id="creator">
          <div>
            <p className="eyebrow">For creators</p>
            <h2>写下你的观点，<br />发布你的作品。</h2>
          </div>
          <div className="creator-banner-side">
            <p>从一篇文章、一条动态到一段视频，LuckRead 为创作者准备了轻量、清晰、可持续的发布入口。</p>
            <Link className="button button-light" href={CREATOR_CENTER_URL}>进入创作者中心<span aria-hidden="true">↗</span></Link>
          </div>
        </section>
      </main>

      <footer className="site-footer" id="about">
        <div className="footer-brand">
          <span className="brand-mark" aria-hidden="true">L</span>
          <div><strong>LuckRead</strong><span>让好内容被看见</span></div>
        </div>
        <p>发现值得阅读的内容，也创造值得留下的内容。</p>
        <span className="footer-note">© LuckRead</span>
      </footer>
    </div>
  )
}
