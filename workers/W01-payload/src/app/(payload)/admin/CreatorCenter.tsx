import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import CreatorContentList from './CreatorContentList'
import PublishComposer from '../../(frontend)/publish/PublishComposer'
import '../../(frontend)/publish/publish.css'
import CreatorCenterAssistant from './CreatorCenterAssistant'
import styles from './creator-center.module.css'

type CreatorNavItem = {
  label: string
  href: string
  hint?: string
  section?: string
  icon: string
}

const primaryNav: CreatorNavItem[] = [
  { label: '首页', href: '#overview', section: '工作台', icon: 'fa-house' },
  { label: '文章管理', href: '#content', section: '内容', icon: 'fa-file-lines' },
  { label: '发布中心', href: '#publisher', section: '内容', icon: 'fa-pen-to-square' },
  { label: '发布检测', href: '#quality', section: '工具', icon: 'fa-shield-heart' },
  { label: '素材库', href: '#assets', section: '素材', icon: 'fa-photo-film' },
]

const futureNav: CreatorNavItem[] = [
  { label: '数据中心', href: '#future-data', hint: '待接入', icon: 'fa-chart-line' },
  { label: '粉丝与订阅', href: '#future-audience', hint: '待接入', icon: 'fa-users' },
  { label: '收益与权益', href: '#future-earnings', hint: '待接入', icon: 'fa-wallet' },
]

export function CreatorCenter({
  initPageResult,
  params,
  searchParams,
  user,
}: AdminViewServerProps) {
  const serverUser = initPageResult.req.user

  if (!serverUser) {
    return (
      <Gutter>
        <section className={styles.authRequired}>
          <span className={styles.eyebrow}>LuckRead Creator Center</span>
          <h1>需要登录后进入创作者中心</h1>
          <p>请使用现有 LuckRead 后台账号登录，不创建第二套创作者登录。</p>
          <Link className={styles.primaryButton} href="/admin/login">
            <i className="fa-solid fa-arrow-right-to-bracket" aria-hidden="true" />
            返回登录
          </Link>
        </section>
      </Gutter>
    )
  }

  const viewUser = user as unknown as {
    displayName?: unknown
    username?: unknown
    email?: unknown
  }

  const displayName =
    typeof viewUser.displayName === 'string' && viewUser.displayName.trim()
      ? viewUser.displayName
      : typeof viewUser.username === 'string' && viewUser.username.trim()
        ? viewUser.username
        : typeof viewUser.email === 'string' && viewUser.email.trim()
          ? viewUser.email
          : '创作者'

  const renderNavItem = (item: CreatorNavItem, active = false, muted = false) => (
    <a
      className={active ? styles.sidebarLinkActive : muted ? styles.sidebarLinkMuted : styles.sidebarLink}
      href={item.href}
      key={item.label}
      aria-current={active ? 'page' : undefined}
    >
      <i className={'fa-solid ' + item.icon + ' ' + styles.sidebarIcon} aria-hidden="true" />
      <span>{item.label}</span>
      {item.hint ? <small>{item.hint}</small> : null}
    </a>
  )

  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={params}
      payload={initPageResult.req.payload}
      permissions={initPageResult.permissions}
      searchParams={searchParams}
      user={user}
      visibleEntities={initPageResult.visibleEntities}
    >
      <div className={styles.creatorLayout}>
        <aside className={styles.sidebar} aria-label="创作者中心侧栏">
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMark}>LR</span>
            <span className={styles.sidebarBrandCopy}>
              <span>LUCKREAD</span>
              <strong>创作者中心</strong>
            </span>
          </div>

          <div className={styles.sidebarUser}>
            <div className={styles.avatar}>{displayName.slice(0, 1).toUpperCase()}</div>
            <div className={styles.sidebarUserText}>
              <strong>{displayName}</strong>
              <span>创作者工作台</span>
            </div>
          </div>

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarLabel}>工作台</span>
            {renderNavItem(primaryNav[0], true)}
          </div>

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarLabel}>内容创作</span>
            {primaryNav.slice(1, 3).map((item) => renderNavItem(item))}
          </div>

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarLabel}>运营工具</span>
            {primaryNav.slice(3).map((item) => renderNavItem(item))}
            {futureNav.map((item) => renderNavItem(item, false, true))}
          </div>

          <div className={styles.sidebarBottom}>
            <Link href="/admin/account">
              <i className="fa-regular fa-user" aria-hidden="true" />
              <span>创作者资料</span>
            </Link>
            <Link href="/admin">
              <i className="fa-solid fa-sliders" aria-hidden="true" />
              <span>平台管理</span>
            </Link>
          </div>
        </aside>

        <main className={styles.main}>
          <header className={styles.topbar + ' navbar'}>
            <div className={styles.topbarTitle}>
              <span>CREATOR STUDIO · WORKSPACE</span>
              <strong>欢迎回来，{displayName}</strong>
            </div>
            <div className={styles.topbarActions}>
              <Link className={styles.ghostButton + ' btn'} href="/">
                <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
                查看前台
              </Link>
              <Link className={styles.primaryButton + ' btn'} href="/publish">
                <i className="fa-solid fa-plus" aria-hidden="true" />
                新建内容
              </Link>
            </div>
          </header>

          <Gutter>
            <div className={styles.contentShell + ' container'}>
              <section id="overview" className={styles.hero + ' card animate__animated animate__fadeInUp'}>
                <div className={styles.heroCopy}>
                  <span className={styles.eyebrow}>TODAY WORKSPACE</span>
                  <h1>把灵感变成内容，<br />再把内容发布出去。</h1>
                  <p>
                    一个真正服务创作者的工作台应该让“写作、上传、检查、审核、发布”连续发生，
                    而不是让你在后台菜单里来回寻找入口。
                  </p>
                  <div className={styles.heroActions}>
                    <Link className={styles.primaryButtonLarge + ' btn'} href="#content">
                      <i className="fa-solid fa-layer-group" aria-hidden="true" />
                      管理我的内容
                    </Link>
                    <Link className={styles.secondaryButtonLarge + ' btn'} href="#publisher">
                      <i className="fa-solid fa-pen-nib" aria-hidden="true" />
                      开始创作
                    </Link>
                  </div>
                </div>
                <div className={styles.heroPanel}>
                  <div className={styles.heroPanelIcon}>
                    <i className="fa-solid fa-route" aria-hidden="true" />
                  </div>
                  <span>当前工作流</span>
                  <strong>内容 → 自检 → 审核 → 发布</strong>
                  <small>草稿自动保留；提交审核时服务端重新执行发布前检测。</small>
                </div>
              </section>

              <section className={styles.quickCreate} aria-label="快速创作">
                <div className={styles.sectionTitle}>
                  <div>
                    <span className={styles.eyebrow}>QUICK CREATE</span>
                    <h2>快速创作</h2>
                  </div>
                  <span>选择一个入口，直接进入现有发布器</span>
                </div>
                <div className={styles.quickGrid}>
                  <Link className={styles.createCard + ' card'} href="/publish?type=article">
                    <span className={styles.createIcon}><i className="fa-solid fa-file-pen" aria-hidden="true" /></span>
                    <span className={styles.createCopy}>
                      <strong>写文章</strong>
                      <small>长文、图文、专题内容</small>
                    </span>
                  </Link>
                  <Link className={styles.createCard + ' card'} href="/publish?type=post">
                    <span className={styles.createIcon}><i className="fa-solid fa-comment-dots" aria-hidden="true" /></span>
                    <span className={styles.createCopy}>
                      <strong>发动态</strong>
                      <small>短内容、观点与即时分享</small>
                    </span>
                  </Link>
                  <Link className={styles.createCard + ' card'} href="/publish?type=video">
                    <span className={styles.createIcon}><i className="fa-solid fa-video" aria-hidden="true" /></span>
                    <span className={styles.createCopy}>
                      <strong>发视频</strong>
                      <small>上传视频与封面素材</small>
                    </span>
                  </Link>
                  <Link className={styles.createCard + ' card'} href="/admin/collections/media">
                    <span className={styles.createIcon}><i className="fa-solid fa-photo-film" aria-hidden="true" /></span>
                    <span className={styles.createCopy}>
                      <strong>素材库</strong>
                      <small>图片、视频、封面统一管理</small>
                    </span>
                  </Link>
                </div>
              </section>

              <section id="content" className={styles.sectionBlock}>
                <div className={styles.sectionTitle}>
                  <div>
                    <span className={styles.eyebrow}>MY CONTENT</span>
                    <h2>文章与内容管理</h2>
                    <p>草稿、审核、已发布、下线内容集中处理。</p>
                  </div>
                  <div className={styles.sectionActions}>
                    <Link className={styles.secondaryButton + ' btn'} href="/admin/collections/media">
                      <i className="fa-solid fa-photo-film" aria-hidden="true" />
                      媒体库
                    </Link>
                    <Link className={styles.primaryButton + ' btn'} href="/publish">
                      <i className="fa-solid fa-plus" aria-hidden="true" />
                      新建内容
                    </Link>
                  </div>
                </div>
                <CreatorContentList />
              </section>

              <section id="publisher" className={styles.sectionBlock}>
                <div className={styles.sectionTitle}>
                  <div>
                    <span className={styles.eyebrow}>PUBLISHER</span>
                    <h2>发布中心</h2>
                    <p>文章、动态、视频共用同一套草稿、预览、媒体与审核生命周期。</p>
                  </div>
                  <span className={styles.statusPill}>W01 会话 · W03 内容权威</span>
                </div>
                <div className={styles.publisherFrame}>
                  <PublishComposer contentBasePath="/api/creator/contents" />
                </div>
              </section>

              <section id="quality" className={styles.toolGrid}>
                <article className={styles.toolCard}>
                  <div className={styles.toolHeader}>
                    <div>
                      <span className={styles.eyebrow}>QUALITY GATE</span>
                      <h2><i className="fa-solid fa-shield-halved" aria-hidden="true" /> 发布前检测助手</h2>
                    </div>
                    <span className={styles.toolState}>已接入</span>
                  </div>
                  <p>发布前检查内容质量、SEO、安全、联系方式、即时通讯账号、二维码提示、外链及 Unicode 绕过风险。</p>
                  <div className={styles.chipRow}>
                    <span>内容质量</span>
                    <span>SEO</span>
                    <span>安全</span>
                    <span>反导流</span>
                    <span>AI 规范</span>
                  </div>
                  <Link className={styles.secondaryButton + ' btn'} href="#publisher">
                    <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true" />
                    在发布器中自检
                  </Link>
                </article>

                <article id="assets" className={styles.toolCard}>
                  <div className={styles.toolHeader}>
                    <div>
                      <span className={styles.eyebrow}>ASSET LIBRARY</span>
                      <h2><i className="fa-solid fa-images" aria-hidden="true" /> 素材库</h2>
                    </div>
                    <span className={styles.toolState}>R2</span>
                  </div>
                  <p>复用现有 Payload Media + R2 能力，创作者可以集中维护图片、视频、封面等素材，再回到发布器使用。</p>
                  <div className={styles.assetLinks}>
                    <Link className={styles.primaryButton + ' btn'} href="/admin/collections/media">
                      打开媒体库
                    </Link>
                    <Link className={styles.secondaryButton + ' btn'} href="/publish">
                      回到发布
                    </Link>
                  </div>
                </article>
              </section>

              <section className={styles.futureGrid} aria-label="后续创作者能力">
                {futureNav.map((item) => (
                  <article className={styles.futureCard} id={item.href.slice(1)} key={item.label}>
                    <span className={styles.futureKicker}>
                      <i className={'fa-solid ' + item.icon} aria-hidden="true" /> {item.hint}
                    </span>
                    <strong>{item.label}</strong>
                    <span>保留主流创作者后台的信息架构位置，待对应业务能力接入后启用。</span>
                  </article>
                ))}
              </section>

              <footer className={styles.footerBar}>
                <div>
                  <strong>需要平台级管理？</strong>
                  <span>进入 Payload 原生后台继续处理系统级 Users、Media 与配置。</span>
                </div>
                <Link className={styles.secondaryButton + ' btn'} href="/admin">
                  <i className="fa-solid fa-sliders" aria-hidden="true" />
                  进入平台后台
                </Link>
              </footer>
            </div>
          </Gutter>
        </main>

        <CreatorCenterAssistant />
      </div>
    </DefaultTemplate>
  )
}
