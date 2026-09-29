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
          <header className={styles.hero}>
            <div>
              <span className={styles.eyebrow}>LuckRead Creator Center</span>
              <h1>创作者中心</h1>
              <p>
                这里是 LuckRead 的创作者工作台。沿用现有 Payload 登录与权限体系，
                内容创作能力独立于平台原生管理界面。
              </p>
            </div>
            <div className={styles.identity}>
              <span className={styles.identityLabel}>当前账号</span>
              <strong>{displayName}</strong>
            </div>
          </header>

          <section className={styles.quickGrid} aria-label="创作者快捷入口">
            <Link className={styles.actionCard} href="/publish">
              <span className={styles.actionKicker}>CONTENT</span>
              <strong>发布内容</strong>
              <span>文章、动态、图文与视频</span>
            </Link>
            <Link className={styles.actionCard} href="/admin/account">
              <span className={styles.actionKicker}>PROFILE</span>
              <strong>创作者资料</strong>
              <span>维护账号与公开创作者信息</span>
            </Link>
            <Link className={styles.actionCard} href="/">
              <span className={styles.actionKicker}>SITE</span>
              <strong>查看 LuckRead</strong>
              <span>返回公开首页与内容体验</span>
            </Link>
          </section>

          <section className={styles.publishSection}>
            <div className={styles.publishHeading}>
              <div>
                <span className={styles.eyebrow}>CONTENT STUDIO</span>
                <h2>发布内容</h2>
              </div>
              <span className={styles.publishHint}>原生 Admin 会话 · W03 内容权威</span>
            </div>
            <PublishComposer contentBasePath="/api/creator/contents" />
          </section>

          <section className={styles.publishSection}>
            <div className={styles.publishHeading}>
              <div>
                <span className={styles.eyebrow}>CONTENT MANAGEMENT</span>
                <h2>我的内容</h2>
              </div>
              <span className={styles.publishHint}>仅显示当前账号 · W03 内容权威</span>
            </div>
            <CreatorContentList />
          </section>

          <section className={styles.contentGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>工作台</span>
                  <h2>开始创作</h2>
                </div>
                <span className={styles.panelBadge}>1.0</span>
              </div>
              <p>
                第一阶段优先打通注册、登录、媒体上传、内容创建、草稿与审核提交。
                这里作为统一入口，后续继续扩展内容管理、数据中心和创作者权益。
              </p>
              <div className={styles.progress}>
                <div>
                  <span>已接入</span>
                  <strong>登录 · 媒体 · 发布</strong>
                </div>
                <div>
                  <span>下一步</span>
                  <strong>内容管理 · 数据</strong>
                </div>
              </div>
              <Link className={styles.primaryButton} href="/publish">
                进入发布器
              </Link>
            </article>

            <aside className={styles.panel}>
              <div className={styles.panelHeading}>
                <div>
                  <span className={styles.eyebrow}>平台后台</span>
                  <h2>保留原生管理能力</h2>
                </div>
              </div>
              <p>
                Payload 原生 Dashboard、Users、Media 等管理入口保持不变。
                Creator Center 只是新增业务工作台，不替换 Payload 后台底座。
              </p>
              <Link className={styles.secondaryButton} href="/admin">
                返回 Payload Admin
              </Link>
            </aside>
          </section>
        </div>
      </Gutter>
    </DefaultTemplate>
  )
}
