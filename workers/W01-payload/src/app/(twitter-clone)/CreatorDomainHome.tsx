import Link from 'next/link'
import { cookies, headers } from 'next/headers'
import { enforcePublicReadRateLimit } from '@/auth/traffic-limit'
import { getBetterAuthPrincipal } from '@/auth/w02-session-client'
import CreatorLanguageToggle from '../(frontend)/creator-center/CreatorLanguageToggle'
import { CreatorStudio } from '../(frontend)/creator-center/CreatorStudio'

type StudioLocale = 'zh-CN' | 'en-US'

export default async function CreatorDomainHome() {
  const requestHeaders = await headers()
  const localeCookie = (await cookies()).get('luckread-ui-locale')?.value
  const locale: StudioLocale = localeCookie === 'en-US' ? 'en-US' : 'zh-CN'
  const request = new Request('https://mp.luckread.com/', { headers: requestHeaders })
  let principal: Awaited<ReturnType<typeof getBetterAuthPrincipal>> | null = null
  try { await enforcePublicReadRateLimit(request); principal = await getBetterAuthPrincipal(request) } catch {}
  if (principal?.active) {
    const displayName = typeof principal.username === 'string' && principal.username.trim() ? principal.username : principal.email
    return <CreatorStudio displayName={displayName} userId={principal.userId} locale={locale} />
  }
  return <div className="mp-entry-shell">
    <header className="mp-entry-header"><Link className="mp-entry-brand" href="/" aria-label={locale === 'en-US' ? 'LuckRead Creator Studio home' : 'LuckRead 创作者中心首页'}><span className="mp-entry-brand-mark">L</span><span>LuckRead Creator Studio</span></Link><div className="mp-entry-header-tools"><span className="mp-entry-domain">mp.luckread.com</span><CreatorLanguageToggle locale={locale} /></div></header>
    <main className="mp-entry-main">
      <section className="mp-entry-copy" aria-labelledby="mp-entry-title"><span className="mp-entry-kicker">CREATOR WORKSPACE</span><h1 id="mp-entry-title">创作、管理、运营，<strong>一站完成。</strong></h1><p>{locale === 'en-US' ? 'Sign in to LuckRead Creator Studio to publish articles, posts, and videos, and manage content, review, media, and audience relationships.' : '登录 LuckRead 账号后进入创作者工作台，直接发布文章、动态和视频，并管理内容、审核、素材与粉丝关系。'}</p><div className="mp-entry-actions"><Link className="mp-entry-primary" href="/login?returnTo=%2F">{locale === 'en-US' ? 'Sign in to Creator Studio' : '登录并进入创作者中心'}</Link><Link className="mp-entry-secondary" href="/creator-center">{locale === 'en-US' ? 'Open creator center' : '进入兼容入口'}</Link></div></section>
      <section className="mp-entry-preview" aria-label="创作者工作台预览"><aside className="mp-entry-sidebar"><div className="mp-entry-mini-logo">LR</div><span>工作台</span><span className="active">首页</span><span>创作</span><span>内容管理</span><span>数据中心</span><span>粉丝与关注</span><span>设置</span></aside><div className="mp-entry-dashboard"><div className="mp-entry-dashboard-top"><div><small>CREATOR DASHBOARD</small><strong>欢迎来到 LuckRead</strong></div><span>发布内容</span></div><div className="mp-entry-create-row"><div><b>文章</b><small>图文与长文</small></div><div><b>动态</b><small>短内容分享</small></div><div><b>视频</b><small>视频内容</small></div></div><div className="mp-entry-stat-row"><div><small>内容</small><b>作品管理</b></div><div><small>质量</small><b>发布检测</b></div><div><small>运营</small><b>粉丝关系</b></div></div></div></section>
    </main>
  </div>
}
