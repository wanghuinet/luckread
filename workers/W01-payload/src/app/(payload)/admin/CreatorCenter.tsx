import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import CreatorContentList from './CreatorContentList'
import PublishComposer from '../../(frontend)/publish/PublishComposer'
import '../../(frontend)/publish/publish.css'
import styles from './creator-center.module.css'

type CreatorNavItem = {
  label: string
  href: string
  hint?: string
  section?: string
}

const primaryNav: CreatorNavItem[] = [
  { label: '首页', href: '#overview', section: '工作台' },
  { label: '文章管理', href: '#content', section: '内容' },
  { label: '发布中心', href: '#publisher', section: '内容' },
  { label: '发布检测', href: '#quality', section: '工具' },
  { label: '素材库', href: '#assets', section: '素材' },
]

const futureNav: CreatorNavItem[] = [
  { label: '数据中心', href: '#future-data', hint: '待接入' },
  { label: '粉丝与订阅', href: '#future-audience', hint: '待接入' },
  { label: '收益与权益', href: '#future-earnings', hint: '待接入' },
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
            <span>LUCKREAD</span>
            <strong>创作者中心</strong>
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
            {primaryNav.slice(0, 1).map((item) => (
              <a className={styles.sidebarLinkActive} href={item.href} key={item.label}>
                <span>{item.label}</span>
              </a>
            ))}
          </div>

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarLabel}>内容创作</span>
            {primaryNav.slice(1, 3).map((item) => (
              <a className={styles.sidebarLink} href={item.href} key={item.label}>
                <span>{item.label}</span>
              </a>
            ))}
          </div>

          <div className={styles.sidebarSection}>
            <span className={styles.sidebarLabel}>运营工具</span>
            {primaryNav.slice(3).map((item) => (
              <a className={styles.sidebarLink} href={item.href} key={item.label}>
                <span>{item.label}</span>
              </a>
            ))}
            {futureNav.map((item) => (
              <a className={styles.sidebarLinkMuted} href={item.href} key={item.label}>
                <span>{item.label}</span>
                <small>{item.hint}</small>
              </a>
            ))}
          </div>

          <div className={styles.sidebarBottom}>
            <Link href="/admin/account">创作者资料</Link>
            <Link href="/admin">平台管理</Link>
          </div>
        </aside>

        <main className={styles.main}>
          <header className={styles.topbar}>
            <div>
              <span className={styles.eyebrow}>CREATOR STUDIO</span>
              <strong>欢迎回来，{displayName}</strong>
            </div>
            <div className={styles.topbarActions}>
              <Link className={styles.ghostButton} href="/">查看前台</Link>
              <Link className={styles.primaryButton} href="/publish">＋ 新建内容</Link>
            </div>
          </header>

          <Gutter>
            <div className={styles.contentShell}>
              <section id="overview" className={styles.hero}>
                <div className={styles.heroCopy}>
                  <span className={styles.eyebrow}>TODAY WORKSPACE</span>
                  <h1>创作、管理、发布，一站完成</h1>
                  <p>
                    以成熟创作者平台常见的“总览 + 内容库 + 发布器 + 工具箱”组织工作流。
                    已上线能力全部从这里进入，底层继续复用现有 Payload、W03 内容权威和 R2 媒体能力。
                  </p>
                  <div className={styles.heroActions}>
                    <Link className={styles.primaryButtonLarge} href="#content">管理我的内容</Link>
                    <Link className={styles.secondaryButtonLarge} href="#publisher">开始创作</Link>
                  </div>
                </div>
                <div className={styles.heroPanel}>
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
                  <span>选择内容类型，直接进入现有发布器</span>
                </div>
                <div className={styles.quickGrid}>
                  <Link className={styles.createCard} href="/publish?type=article">
                    <span className={styles.createIcon}>文</span>
                    <strong>写文章</strong>
                    <small>长文、图文、专题内容</small>
                  </Link>
                  <Link className={styles.createCard} href="/publish?type=post">
                    <span className={styles.createIcon}>动</span>
                    <strong>发动态</strong>
                    <small>短内容、观点与即时分享</small>
                  </Link>
                  <Link className={styles.createCard} href="/publish?type=video">
                    <span className={styles.createIcon}>视</span>
                    <strong>发视频</strong>
                    <small>上传视频与封面素材</small>
                  </Link>
                  <Link className={styles.createCard} href="/admin/collections/media">
                    <span className={styles.createIcon}>媒</span>
                    <strong>素材库</strong>
                    <small>管理 R2 媒体资源</small>
                  </Link>
                </div>
              </section>

              <section id="content" className={styles.sectionBlock}>
                <div className={styles.sectionTitle}>
                  <div>
                    <span className={styles.eyebrow}>MY CONTENT</span>
                    <h2>文章与内容管理</h2>
                    <p>把每天最常用的草稿、审核、已发布和下线内容集中处理。</p>
                  </div>
                  <div className={styles.sectionActions}>
                    <Link className={styles.secondaryButton} href="/admin/collections/media">媒体库</Link>
                    <Link className={styles.primaryButton} href="/publish">新建内容</Link>
                  </div>
                </div>
                <CreatorContentList />
              </section>

              <section id="publisher" className={styles.sectionBlock}>
                <div className={styles.sectionTitle}>
                  <div>
                    <span className={styles.eyebrow}>PUBLISHER</span>
                    <h2>发布中心</h2>
                    <p>文章、动态、视频共用同一套草稿、预览、媒体、审核和状态生命周期。</p>
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
                      <h2>发布前检测助手</h2>
                    </div>
                    <span className={styles.toolState}>已接入</span>
                  </div>
                  <p>在提交审核前检查内容质量、SEO、安全、联系方式、即时通讯账号、二维码提示、外链及 Unicode 绕过风险。</p>
                  <div className={styles.chipRow}>
                    <span>内容质量</span>
                    <span>SEO</span>
                    <span>安全</span>
                    <span>反导流</span>
                    <span>AI 规范</span>
                  </div>
                  <Link className={styles.secondaryButton} href="#publisher">在发布器中自检</Link>
                </article>

                <article id="assets" className={styles.toolCard}>
                  <div className={styles.toolHeader}>
                    <div>
                      <span className={styles.eyebrow}>ASSET LIBRARY</span>
                      <h2>素材库</h2>
                    </div>
                    <span className={styles.toolState}>R2</span>
                  </div>
                  <p>复用现有 Payload Media + R2 能力，创作者可以集中维护图片、视频、封面等素材，再回到发布器使用。</p>
                  <div className={styles.assetLinks}>
                    <Link className={styles.primaryButton} href="/admin/collections/media">打开媒体库</Link>
                    <Link className={styles.secondaryButton} href="/publish">回到发布</Link>
                  </div>
                </article>
              </section>

              <section className={styles.futureGrid} aria-label="后续创作者能力">
                {futureNav.map((item) => (
                  <article className={styles.futureCard} id={item.href.slice(1)} key={item.label}>
                    <span className={styles.futureKicker}>{item.hint}</span>
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
                <Link className={styles.secondaryButton} href="/admin">进入平台后台</Link>
              </footer>
            </div>
          </Gutter>
        </main>

        <Link className={styles.floatingAssistant} href="#quality" aria-label="打开发布前检测助手">
          <span className={styles.assistantDot}>✓</span>
          <span>
            <strong>检测助手</strong>
            <small>发布前自检</small>
          </span>
        </Link>
      </div>
    </DefaultTemplate>
  )
}
