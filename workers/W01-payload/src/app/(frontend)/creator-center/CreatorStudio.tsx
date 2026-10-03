import Link from 'next/link'
import React from 'react'

import CreatorLanguageToggle from './CreatorLanguageToggle'

import CreatorContentList from '../../(payload)/v1beta/CreatorContentList'
import CreatorCenterAssistant from '../../(payload)/v1beta/CreatorCenterAssistant'
import CreatorAudienceSummary from '../../(payload)/v1beta/CreatorAudienceSummary'
import CreatorAssetLibrary from '../../(payload)/v1beta/CreatorAssetLibrary'
import CreatorModerationQueue from '../../(payload)/v1beta/CreatorModerationQueue'
import PublishComposer from '../publish/PublishComposer'
import '../publish/publish.css'
import styles from '../../(payload)/v1beta/creator-center.module.css'

type CreatorNavItem = {
  label: string
  href: string
  icon: string
  hint?: string
}

type StudioLocale = 'zh-CN' | 'en-US'

const navigationByLocale: Record<StudioLocale, {
  workspace: CreatorNavItem[]
  creation: CreatorNavItem[]
  manage: CreatorNavItem[]
  operate: CreatorNavItem[]
  system: CreatorNavItem[]
  labels: {
    workspace: string
    creation: string
    content: string
    operations: string
    other: string
    publish: string
  }
}> = {
  'zh-CN': {
    workspace: [{ label: '首页', href: '#overview', icon: 'fa-house' }],
    creation: [
      { label: '写文章', href: '#publisher', icon: 'fa-file-pen' },
      { label: '发动态', href: '#publisher', icon: 'fa-comment-dots' },
      { label: '发视频', href: '#publisher', icon: 'fa-video' },
    ],
    manage: [
      { label: '内容管理', href: '#content', icon: 'fa-list-check' },
      { label: '审核与发布', href: '#quality', icon: 'fa-shield-halved' },
      { label: '素材库', href: '#assets', icon: 'fa-photo-film' },
    ],
    operate: [
      { label: '粉丝与关注', href: '#audience', icon: 'fa-users' },
      { label: '数据中心', href: '#future-data', icon: 'fa-chart-line', hint: '即将开放' },
      { label: '收益中心', href: '#future-earnings', icon: 'fa-wallet', hint: '即将开放' },
      { label: '创作者成长', href: '#future-growth', icon: 'fa-arrow-up-right-dots', hint: '即将开放' },
    ],
    system: [
      { label: '创作工具', href: '#quality', icon: 'fa-wand-magic-sparkles' },
      { label: '账号设置', href: '/me/profile', icon: 'fa-gear' },
    ],
    labels: { workspace: '工作台', creation: '创作', content: '内容', operations: '运营', other: '其他', publish: '发布内容' },
  },
  'en-US': {
    workspace: [{ label: 'Home', href: '#overview', icon: 'fa-house' }],
    creation: [
      { label: 'Write article', href: '#publisher', icon: 'fa-file-pen' },
      { label: 'New post', href: '#publisher', icon: 'fa-comment-dots' },
      { label: 'Publish video', href: '#publisher', icon: 'fa-video' },
    ],
    manage: [
      { label: 'Content', href: '#content', icon: 'fa-list-check' },
      { label: 'Review & publish', href: '#quality', icon: 'fa-shield-halved' },
      { label: 'Media library', href: '#assets', icon: 'fa-photo-film' },
    ],
    operate: [
      { label: 'Audience', href: '#audience', icon: 'fa-users' },
      { label: 'Analytics', href: '#future-data', icon: 'fa-chart-line', hint: 'Coming soon' },
      { label: 'Earnings', href: '#future-earnings', icon: 'fa-wallet', hint: 'Coming soon' },
      { label: 'Creator growth', href: '#future-growth', icon: 'fa-arrow-up-right-dots', hint: 'Coming soon' },
    ],
    system: [
      { label: 'Creator tools', href: '#quality', icon: 'fa-wand-magic-sparkles' },
      { label: 'Account settings', href: '/me/profile', icon: 'fa-gear' },
    ],
    labels: { workspace: 'WORKSPACE', creation: 'CREATE', content: 'CONTENT', operations: 'OPERATE', other: 'OTHER', publish: 'Publish' },
  },
}


export function CreatorStudio({
  displayName,
  userId,
  locale = 'zh-CN',
  adminMode = false,
}: {
  displayName: string
  userId: string
  locale?: StudioLocale
  adminMode?: boolean
}) {
  const nav = navigationByLocale[locale]

  const renderNav = (items: CreatorNavItem[]) => (
    <div className={styles.sidebarNavList}>
      {items.map((item) => {
        const disabled = Boolean(item.hint)
        const className = disabled ? styles.sidebarNavDisabled : styles.sidebarNavLink
        return disabled ? (
          <a className={className} href={item.href} key={item.label} aria-disabled="true">
            <i className={'fa-solid ' + item.icon + ' ' + styles.sidebarIcon} aria-hidden="true" />
            <span>{item.label}</span>
            <small>{item.hint}</small>
          </a>
        ) : (
          <a className={className} href={item.href} key={item.label}>
            <i className={'fa-solid ' + item.icon + ' ' + styles.sidebarIcon} aria-hidden="true" />
            <span>{item.label}</span>
          </a>
        )
      })}
    </div>
  )

  return (
    <div className={styles.creatorLayout + ' ' + styles.studioLayout}>
        <aside className={styles.sidebar} aria-label={locale === "en-US" ? "LuckRead Creator Studio navigation" : "LuckRead 创作者中心导航"}>
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMark}>LR</span>
            <span className={styles.sidebarBrandCopy}>
              <span>LUCKREAD</span>
              <strong>{locale === 'en-US' ? 'Creator Studio' : '创作者中心'}</strong>
            </span>
          </div>

          <div className={styles.sidebarProfile}>
            <div className={styles.avatar}>{displayName.slice(0, 1).toUpperCase()}</div>
            <div className={styles.sidebarProfileCopy}>
              <strong>{displayName}</strong>
              <span>{locale === 'en-US' ? 'Creator account' : '创作者账号'}</span>
            </div>
            <span className={styles.onlineDot} title={locale === "en-US" ? "Account in good standing" : "账号正常"} aria-label={locale === "en-US" ? "Account in good standing" : "账号正常"} />
          </div>

          <Link className={styles.sidebarPublishButton} href="#publisher">
            <i className="fa-solid fa-plus" aria-hidden="true" />
            发布内容
          </Link>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>{nav.labels.workspace}</span>
            {renderNav(nav.workspace)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>{nav.labels.creation}</span>
            {renderNav(nav.creation)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>{nav.labels.content}</span>
            {renderNav(nav.manage)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>{nav.labels.operations}</span>
            {renderNav(nav.operate)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>{nav.labels.other}</span>
            {renderNav(nav.system)}
          </div>

          <div className={styles.sidebarFooter}>
            <Link href="https://luckread.com/">
              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
              <span>查看 LuckRead 主站</span>
            </Link>
            <span className={styles.sidebarVersion}>Creator Studio · 1.0</span>
          </div>
        </aside>

        <main className={styles.studioMain}>
          <header className={styles.studioTopbar + ' navbar'}>
            <div className={styles.studioBreadcrumb}>
              <span>Creator Studio</span>
              <i className="fa-solid fa-chevron-right" aria-hidden="true" />
              <strong>{locale === 'en-US' ? 'Home' : '首页'}</strong>
            </div>
            <div className={styles.topbarActions}>
              <CreatorLanguageToggle locale={locale} />
              <a className={styles.topbarLink} href="#quality">
                <i className="fa-regular fa-circle-check" aria-hidden="true" />
                {locale === 'en-US' ? 'Publish check' : '发布检测'}
              </a>
              <a className={styles.topbarLink} href="#audience">
                <i className="fa-solid fa-users" aria-hidden="true" />
                {locale === 'en-US' ? 'Audience' : '粉丝'}
              </a>
              <a className={styles.topbarLink} href="#future-data">
                <i className="fa-solid fa-chart-simple" aria-hidden="true" />
                {locale === 'en-US' ? 'Analytics' : '数据'}
              </a>
              <Link className={styles.topbarSiteButton} href="https://luckread.com/">
                <i className="fa-solid fa-globe" aria-hidden="true" />
                {locale === 'en-US' ? 'Main site' : '主站'}
              </Link>
              <Link className={styles.topbarAvatar} href="/me/profile" aria-label={locale === "en-US" ? "Account settings" : "账号设置"}>
                {displayName.slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </header>

          <div className={styles.studioShell}>
              <section id="overview" className={styles.dashboardWelcome}>
                <div>
                  <span className={styles.dashboardKicker}>CREATOR DASHBOARD</span>
                  <h1>{locale === 'en-US' ? 'Welcome back, ' : '欢迎回来，'}{displayName}</h1>
                  <p>{locale === 'en-US' ? 'Create, review, publish, and manage your everyday content from one workspace.' : '从创作、审核到发布，在一个工作台完成你的内容日常。'}</p>
                </div>
                <div className={styles.accountStatusCard}>
                  <span className={styles.accountStatusIcon}>
                    <i className="fa-solid fa-circle-check" aria-hidden="true" />
                  </span>
                  <div>
                    <strong>{locale === 'en-US' ? 'Account in good standing' : '账号状态正常'}</strong>
                    <span>{locale === 'en-US' ? 'You can keep creating and publishing' : '可以继续创作与发布内容'}</span>
                  </div>
                </div>
              </section>

              <section className={styles.quickCreatePanel} aria-label="快速创作">
                <div className={styles.panelHeading}>
                  <div>
                    <span className={styles.dashboardKicker}>CREATE</span>
                    <h2>{locale === 'en-US' ? 'Quick create' : '快速创作'}</h2>
                  </div>
                  <span>{locale === 'en-US' ? 'Choose a format and jump straight into the editor' : '选择内容类型，直接进入编辑器'}</span>
                </div>
                <div className={styles.quickCreateGrid}>
                  <Link className={styles.quickCreateItem} href="/publish?type=article">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-file-lines" aria-hidden="true" /></span>
                    <span><strong>{locale === 'en-US' ? 'Article' : '文章'}</strong><small>{locale === 'en-US' ? 'Long-form text & images' : '图文与长文内容'}</small></span>
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </Link>
                  <Link className={styles.quickCreateItem} href="/publish?type=post">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-comment-dots" aria-hidden="true" /></span>
                    <span><strong>{locale === 'en-US' ? 'Post' : '动态'}</strong><small>{locale === 'en-US' ? 'Short-form updates' : '短内容与即时分享'}</small></span>
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </Link>
                  <Link className={styles.quickCreateItem} href="/publish?type=video">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-video" aria-hidden="true" /></span>
                    <span><strong>{locale === 'en-US' ? 'Video' : '视频'}</strong><small>{locale === 'en-US' ? 'Video & cover assets' : '视频与封面素材'}</small></span>
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </Link>
                </div>
              </section>

              <section className={styles.workspaceGrid}>
                <div className={styles.workspaceMainColumn}>
                  <section id="content" className={styles.dashboardCard}>
                    <CreatorContentList loginPath={adminMode ? '/admin/login' : '/login'} />
                  </section>

                  <section id="publisher" className={styles.dashboardCard}>
                    <div className={styles.panelHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>PUBLISH</span>
                        <h2>{locale === 'en-US' ? 'Publish center' : '发布中心'}</h2>
                      </div>
                      <span>{locale === 'en-US' ? 'Draft → check → review → publish' : '草稿 → 检测 → 审核 → 发布'}</span>
                    </div>
                    <div className={styles.publisherFrame}>
                      <PublishComposer contentBasePath="/api/creator/contents" />
                    </div>
                  </section>
                </div>

                <aside className={styles.workspaceSideColumn}>
                  <section id="quality" className={styles.sideCard}>
                    <div className={styles.sideCardHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>QUALITY</span>
                        <h2>{locale === 'en-US' ? 'Publish check' : '发布检测'}</h2>
                      </div>
                      <span className={styles.greenPill}>已接入</span>
                    </div>
                    <p>{locale === 'en-US' ? 'Check content quality, SEO, safety, contact patterns, external links, and anti-diversion risks before submission.' : '提交前检查内容质量、SEO、安全、联系方式、外链与反导流风险。'}</p>
                    <div className={styles.qualityRows}>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> {locale === 'en-US' ? 'Content quality' : '内容质量'}</span>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> SEO</span>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> {locale === 'en-US' ? 'Safety & anti-diversion' : '安全与反导流'}</span>
                    </div>
                    <a className={styles.sideActionLink} href="#publisher">
                      {locale === 'en-US' ? 'Run checks in publisher' : '在发布器中自检'}
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                    </a>
                  </section>

                  <section id="assets" className={styles.sideCard}>
                    <div className={styles.sideCardHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>MEDIA</span>
                        <h2>{locale === 'en-US' ? 'Media library' : '素材库'}</h2>
                      </div>
                      <span className={styles.mutedPill}>R2</span>
                    </div>
                    <p>{locale === 'en-US' ? 'Manage images, videos, and cover assets in one place and reuse them while publishing.' : '统一管理图片、视频与封面素材。'}</p>
                    <CreatorAssetLibrary adminMode={adminMode} loginPath={adminMode ? '/admin/login' : '/login'} />
                  </section>

                  <section className={styles.sideCard}>
                    <div className={styles.sideCardHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>WORKFLOW</span>
                        <h2>{locale === 'en-US' ? 'Publishing workflow' : '当前发布链路'}</h2>
                      </div>
                    </div>
                    <div className={styles.workflowSteps}>
                      <span><b>01</b> {locale === 'en-US' ? 'Create' : '创作'}</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>02</b> {locale === 'en-US' ? 'Check' : '自检'}</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>03</b> {locale === 'en-US' ? 'Review' : '审核'}</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>04</b> {locale === 'en-US' ? 'Publish' : '发布'}</span>
                    </div>
                  </section>
                </aside>
              </section>

              {adminMode ? <CreatorModerationQueue /> : null}

              <CreatorAudienceSummary userId={String(userId)} loginPath={adminMode ? '/admin/login' : '/login'} />

              <section className={styles.futureDashboardGrid} aria-label="后续创作者能力">
                <article id="future-data" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-chart-line" aria-hidden="true" /> {locale === 'en-US' ? 'Analytics' : '数据中心'}</strong>
                  <span>{locale === 'en-US' ? 'Content performance, reads, plays, engagement, and audience growth.' : '作品表现、阅读、播放、互动与粉丝增长分析。'}</span>
                </article>
                <article id="future-earnings" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-wallet" aria-hidden="true" /> {locale === 'en-US' ? 'Earnings' : '收益中心'}</strong>
                  <span>{locale === 'en-US' ? 'Subscriptions, paid content, benefits, and future monetization data.' : '订阅、付费内容、权益和后续商业化数据。'}</span>
                </article>
                <article id="future-growth" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-arrow-up-right-dots" aria-hidden="true" /> {locale === 'en-US' ? 'Creator growth' : '创作者成长'}</strong>
                  <span>{locale === 'en-US' ? 'Missions, benefits, verification, and growth guidance.' : '创作任务、权益、认证和成长建议。'}</span>
                </article>
              </section>

              <footer className={styles.studioFooter}>
                <div>
                  <strong>LuckRead Creator Studio</strong>
                  <span>{locale === 'en-US' ? 'One workspace for creating, managing, and operating.' : '创作、管理、运营统一工作台'}</span>
                </div>
                <div>
                  <Link href="/me/profile">{locale === 'en-US' ? 'Account settings' : '账号设置'}</Link>
                  <Link href="https://luckread.com/">{locale === 'en-US' ? 'Back to LuckRead' : '回到主站'}</Link>
                </div>
              </footer>
          </div>
        </main>

        <CreatorCenterAssistant />
      </div>
  )
}
