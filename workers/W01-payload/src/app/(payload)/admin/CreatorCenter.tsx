import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import Link from 'next/link'
import React from 'react'

import { CreatorStudio } from './CreatorStudio'
import PublishComposer from '../../(frontend)/publish/PublishComposer'
import '../../(frontend)/publish/publish.css'
import styles from './creator-center.module.css'

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
          <span className={styles.eyebrow}>LuckRead Creator Studio</span>
          <h1>登录后进入创作者中心</h1>
          <p>使用现有 LuckRead 账号即可进入，不创建第二套创作者登录。</p>
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
      <CreatorStudio displayName={displayName} userId={String(serverUser.id)} />
    </DefaultTemplate>
  )
}
