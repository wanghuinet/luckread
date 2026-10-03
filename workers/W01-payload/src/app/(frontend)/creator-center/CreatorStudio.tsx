import Link from 'next/link'
import React from 'react'

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

const workspaceNav: CreatorNavItem[] = [
  { label: '首页', href: '#overview', icon: 'fa-house' },
]

const creationNav: CreatorNavItem[] = [
  { label: '写文章', href: '#publisher', icon: 'fa-file-pen' },
  { label: '发动态', href: '#publisher', icon: 'fa-comment-dots' },
  { label: '发视频', href: '#publisher', icon: 'fa-video' },
]

const manageNav: CreatorNavItem[] = [
  { label: '内容管理', href: '#content', icon: 'fa-list-check' },
  { label: '审核与发布', href: '#quality', icon: 'fa-shield-halved' },
  { label: '素材库', href: '#assets', icon: 'fa-photo-film' },
]

const operateNav: CreatorNavItem[] = [
  { label: '粉丝与关注', href: '#audience', icon: 'fa-users' },
  { label: '数据中心', href: '#future-data', icon: 'fa-chart-line', hint: '即将开放' },
  { label: '收益中心', href: '#future-earnings', icon: 'fa-wallet', hint: '即将开放' },
  { label: '创作者成长', href: '#future-growth', icon: 'fa-arrow-up-right-dots', hint: '即将开放' },
]

const systemNav: CreatorNavItem[] = [
  { label: '创作工具', href: '#quality', icon: 'fa-wand-magic-sparkles' },
  { label: '账号设置', href: '/me/profile', icon: 'fa-gear' },
]

export function CreatorStudio({
  displayName,
  userId,
  adminMode = false,
}: {
  displayName: string
  userId: string
  adminMode?: boolean
}) {
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
        <aside className={styles.sidebar} aria-label="LuckRead 创作者中心导航">
          <div className={styles.sidebarBrand}>
            <span className={styles.brandMark}>LR</span>
            <span className={styles.sidebarBrandCopy}>
              <span>LUCKREAD</span>
              <strong>创作者中心</strong>
            </span>
          </div>

          <div className={styles.sidebarProfile}>
            <div className={styles.avatar}>{displayName.slice(0, 1).toUpperCase()}</div>
            <div className={styles.sidebarProfileCopy}>
              <strong>{displayName}</strong>
              <span>创作者账号</span>
            </div>
            <span className={styles.onlineDot} title="账号正常" aria-label="账号正常" />
          </div>

          <Link className={styles.sidebarPublishButton} href="#publisher">
            <i className="fa-solid fa-plus" aria-hidden="true" />
            发布内容
          </Link>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>工作台</span>
            {renderNav(workspaceNav)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>创作</span>
            {renderNav(creationNav)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>内容</span>
            {renderNav(manageNav)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>运营</span>
            {renderNav(operateNav)}
          </div>

          <div className={styles.sidebarGroup}>
            <span className={styles.sidebarLabel}>其他</span>
            {renderNav(systemNav)}
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
              <strong>首页</strong>
            </div>
            <div className={styles.topbarActions}>
              <a className={styles.topbarLink} href="#quality">
                <i className="fa-regular fa-circle-check" aria-hidden="true" />
                发布检测
              </a>
              <a className={styles.topbarLink} href="#audience">
                <i className="fa-solid fa-users" aria-hidden="true" />
                粉丝
              </a>
              <a className={styles.topbarLink} href="#future-data">
                <i className="fa-solid fa-chart-simple" aria-hidden="true" />
                数据
              </a>
              <Link className={styles.topbarSiteButton} href="https://luckread.com/">
                <i className="fa-solid fa-globe" aria-hidden="true" />
                主站
              </Link>
              <Link className={styles.topbarAvatar} href="/me/profile" aria-label="账号设置">
                {displayName.slice(0, 1).toUpperCase()}
              </Link>
            </div>
          </header>

          <div className={styles.studioShell}>
              <section id="overview" className={styles.dashboardWelcome}>
                <div>
                  <span className={styles.dashboardKicker}>CREATOR DASHBOARD</span>
                  <h1>欢迎回来，{displayName}</h1>
                  <p>从创作、审核到发布，在一个工作台完成你的内容日常。</p>
                </div>
                <div className={styles.accountStatusCard}>
                  <span className={styles.accountStatusIcon}>
                    <i className="fa-solid fa-circle-check" aria-hidden="true" />
                  </span>
                  <div>
                    <strong>账号状态正常</strong>
                    <span>可以继续创作与发布内容</span>
                  </div>
                </div>
              </section>

              <section className={styles.quickCreatePanel} aria-label="快速创作">
                <div className={styles.panelHeading}>
                  <div>
                    <span className={styles.dashboardKicker}>CREATE</span>
                    <h2>快速创作</h2>
                  </div>
                  <span>选择内容类型，直接进入编辑器</span>
                </div>
                <div className={styles.quickCreateGrid}>
                  <Link className={styles.quickCreateItem} href="/publish?type=article">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-file-lines" aria-hidden="true" /></span>
                    <span><strong>文章</strong><small>图文与长文内容</small></span>
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </Link>
                  <Link className={styles.quickCreateItem} href="/publish?type=post">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-comment-dots" aria-hidden="true" /></span>
                    <span><strong>动态</strong><small>短内容与即时分享</small></span>
                    <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                  </Link>
                  <Link className={styles.quickCreateItem} href="/publish?type=video">
                    <span className={styles.quickCreateIcon}><i className="fa-solid fa-video" aria-hidden="true" /></span>
                    <span><strong>视频</strong><small>视频与封面素材</small></span>
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
                        <h2>发布中心</h2>
                      </div>
                      <span>草稿 → 检测 → 审核 → 发布</span>
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
                        <h2>发布检测</h2>
                      </div>
                      <span className={styles.greenPill}>已接入</span>
                    </div>
                    <p>提交前检查内容质量、SEO、安全、联系方式、外链与反导流风险。</p>
                    <div className={styles.qualityRows}>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> 内容质量</span>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> SEO</span>
                      <span><i className="fa-solid fa-check" aria-hidden="true" /> 安全与反导流</span>
                    </div>
                    <a className={styles.sideActionLink} href="#publisher">
                      在发布器中自检
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                    </a>
                  </section>

                  <section id="assets" className={styles.sideCard}>
                    <div className={styles.sideCardHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>MEDIA</span>
                        <h2>素材库</h2>
                      </div>
                      <span className={styles.mutedPill}>R2</span>
                    </div>
                    <p>统一管理图片、视频与封面素材，并在发布时复用。</p>
                    <CreatorAssetLibrary adminMode={adminMode} loginPath={adminMode ? '/admin/login' : '/login'} />
                  </section>

                  <section className={styles.sideCard}>
                    <div className={styles.sideCardHeading}>
                      <div>
                        <span className={styles.dashboardKicker}>WORKFLOW</span>
                        <h2>当前发布链路</h2>
                      </div>
                    </div>
                    <div className={styles.workflowSteps}>
                      <span><b>01</b> 创作</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>02</b> 自检</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>03</b> 审核</span>
                      <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                      <span><b>04</b> 发布</span>
                    </div>
                  </section>
                </aside>
              </section>

              {adminMode ? <CreatorModerationQueue /> : null}

              <CreatorAudienceSummary userId={String(userId)} loginPath={adminMode ? '/admin/login' : '/login'} />

              <section className={styles.futureDashboardGrid} aria-label="后续创作者能力">
                <article id="future-data" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-chart-line" aria-hidden="true" /> 数据中心</strong>
                  <span>作品表现、阅读、播放、互动与粉丝增长分析。</span>
                </article>
                <article id="future-earnings" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-wallet" aria-hidden="true" /> 收益中心</strong>
                  <span>订阅、付费内容、权益和后续商业化数据。</span>
                </article>
                <article id="future-growth" className={styles.futureDashboardCard}>
                  <span className={styles.dashboardKicker}>COMING NEXT</span>
                  <strong><i className="fa-solid fa-arrow-up-right-dots" aria-hidden="true" /> 创作者成长</strong>
                  <span>创作任务、权益、认证和成长建议。</span>
                </article>
              </section>

              <footer className={styles.studioFooter}>
                <div>
                  <strong>LuckRead Creator Studio</strong>
                  <span>创作、管理、运营统一工作台</span>
                </div>
                <div>
                  <Link href="/me/profile">账号设置</Link>
                  <Link href="https://luckread.com/">回到主站</Link>
                </div>
              </footer>
          </div>
        </main>

        <CreatorCenterAssistant />
      </div>
  )
}
