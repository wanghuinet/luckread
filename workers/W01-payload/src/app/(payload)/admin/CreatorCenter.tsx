import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import CreatorContentList from './CreatorContentList'
import PublishComposer from '../../(frontend)/publish/PublishComposer'
import '../../(frontend)/publish/publish.css'
import styles from './creator-center.module.css'

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
      <Gutter>
        <div className={styles.shell}>
          <nav className={styles.creatorNav} aria-label="创作者中心导航">
            <div className={styles.brandBlock}>
              <span className={styles.navBrand}>LUCKREAD</span>
              <strong>创作者中心</strong>
            </div>

            <div className={styles.navLinks}>
              <a href="#dashboard" className={styles.navLink}>总览</a>
              <a href="#content-management" className={styles.navLink}>内容管理</a>
              <a href="#publisher" className={styles.navLink}>发布</a>
              <a href="#creator-tools" className={styles.navLink}>创作工具</a>
            </div>

            <div className={styles.navActions}>
              <Link className={styles.navPrimary} href="/publish">＋ 新建内容</Link>
              <Link className={styles.navSecondary} href="/admin/account">账号</Link>
            </div>
          </nav>

          <section id="dashboard" className={styles.hero}>
            <div>
              <span className={styles.eyebrow}>CREATOR WORKSPACE</span>
              <h1>把创作、管理、发布和自检放到一个工作台</h1>
              <p>
                LuckRead 创作者中心沿用现有 Payload 登录、W03 内容权威和媒体上传能力，
                把已经开发完成的内容流程集中到一个入口。这里不替换平台原生后台，而是提供面向创作者的业务工作台。
              </p>
            </div>
            <div className={styles.identity}>
              <span className={styles.identityLabel}>当前创作者</span>
              <strong>{displayName}</strong>
              <span className={styles.identityMeta}>已登录 · 原生后台会话</span>
            </div>
          </section>

          <section className={styles.overviewGrid} aria-label="创作者功能总览">
            <Link className={styles.featureCard} href="#content-management">
              <span className={styles.featureIcon}>01</span>
              <div>
                <strong>文章 / 动态 / 视频</strong>
                <span>统一管理草稿、审核、已发布和已下线内容。</span>
              </div>
              <span className={styles.featureArrow}>→</span>
            </Link>

            <Link className={styles.featureCard} href="#publisher">
              <span className={styles.featureIcon}>02</span>
              <div>
                <strong>发布器</strong>
                <span>图文、动态、视频、媒体上传、草稿和审核提交。</span>
              </div>
              <span className={styles.featureArrow}>→</span>
            </Link>

            <Link className={styles.featureCard} href="/publish">
              <span className={styles.featureIcon}>03</span>
              <div>
                <strong>发布前自检</strong>
                <span>提交审核前自动执行质量、SEO、安全、联系方式和导流检查。</span>
              </div>
              <span className={styles.featureArrow}>→</span>
            </Link>

            <Link className={styles.featureCard} href="/admin/collections/media">
              <span className={styles.featureIcon}>04</span>
              <div>
                <strong>媒体库</strong>
                <span>管理已经接入 R2 的图片、视频及其他媒体资源。</span>
              </div>
              <span className={styles.featureArrow}>→</span>
            </Link>
          </section>

          <section id="content-management" className={styles.workSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>CONTENT MANAGEMENT</span>
                <h2>内容管理</h2>
                <p>这是创作者的内容主工作区：先管理内容，再进入具体编辑和发布流程。</p>
              </div>
              <div className={styles.headingActions}>
                <Link className={styles.secondaryButton} href="/admin/collections/media">媒体库</Link>
                <Link className={styles.primaryButton} href="/publish">新建内容</Link>
              </div>
            </div>

            <CreatorContentList />
          </section>

          <section id="publisher" className={styles.workSection}>
            <div className={styles.sectionHeading}>
              <div>
                <span className={styles.eyebrow}>CONTENT STUDIO</span>
                <h2>发布中心</h2>
                <p>文章、动态、视频共用同一个发布流程；保存草稿后再提交审核，服务端会重新执行发布前检测。</p>
              </div>
              <span className={styles.workflowBadge}>W01 会话 · W03 内容权威</span>
            </div>

            <PublishComposer contentBasePath="/api/creator/contents" />
          </section>

          <section id="creator-tools" className={styles.toolsGrid}>
            <article className={styles.toolPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>PUBLISH PREFLIGHT</span>
                  <h2>发布前检测助手</h2>
                </div>
                <span className={styles.panelBadge}>自动</span>
              </div>
              <p>
                发布器已经接入发布前检测。提交审核时会检查 AI 使用规范、内容质量、标题与 SEO、
                外链、手机号、即时通讯账号、二维码提示、隐藏代码及 Unicode 绕过风险。
              </p>
              <div className={styles.toolList}>
                <span>✓ 质量与结构</span>
                <span>✓ SEO 与标题</span>
                <span>✓ 联系方式与导流</span>
                <span>✓ 安全与隐藏内容</span>
              </div>
              <Link className={styles.primaryButton} href="/publish">进入自检与发布</Link>
            </article>

            <article className={styles.toolPanel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>CREATOR ASSETS</span>
                  <h2>素材与账号</h2>
                </div>
              </div>
              <p>
                媒体上传继续使用现有 R2 + Payload Media 能力；账号资料继续使用现有后台权限体系。
              </p>
              <div className={styles.toolActions}>
                <Link className={styles.secondaryButton} href="/admin/collections/media">打开媒体库</Link>
                <Link className={styles.secondaryButton} href="/admin/account">创作者资料</Link>
                <Link className={styles.secondaryButton} href="/">查看公开站点</Link>
              </div>
            </article>
          </section>

          <section className={styles.footerPanel}>
            <div>
              <span className={styles.eyebrow}>PLATFORM ADMIN</span>
              <strong>需要更底层的管理能力？</strong>
              <span>Payload 原生 Dashboard、Users、Media 等管理入口保持不变。</span>
            </div>
            <Link className={styles.secondaryButton} href="/admin">返回 Payload Admin</Link>
          </section>

          <Link className={styles.floatingAssistant} href="#creator-tools" aria-label="打开发布前检测助手">
            <span className={styles.assistantDot}>✓</span>
            <span>
              <strong>检测助手</strong>
              <small>发布前自检</small>
            </span>
          </Link>
        </div>
      </Gutter>
    </DefaultTemplate>
  )
}
