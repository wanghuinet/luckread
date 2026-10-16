'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../lib/client-api.js'
import LuckReadSocialPostCard from '../(frontend)/components/reuse/LuckReadSocialPostCard'
import type { PublicLocale } from '../(frontend)/i18n/public-locale'
import { getTwitterCloneCopy } from './twitter-clone-copy'

export type HomeContentItem = { id:string; slug?:string; ownerUserId?:string; creatorId?:string|null; createdAt?:string; updatedAt?:string; contentType:'article'|'post'|'video'; title:string; bodyRef?:string; mediaRefs?:string[]; coverRef?:string|null }
export type HomeContentPage = { items:HomeContentItem[]; nextCursor:string|null; hasMore:boolean; candidateWindowTruncated?:boolean }
export type HomeFeedMode = 'for-you' | 'following'

export default function TwitterCloneHomeFeed({initialPage,locale,feedMode}:{initialPage:HomeContentPage;locale:PublicLocale;feedMode:HomeFeedMode}) {
  const copy = getTwitterCloneCopy(locale)
  const [items,setItems] = useState<HomeContentItem[]>(initialPage.items)
  const [nextCursor,setNextCursor] = useState<string|null>(initialPage.nextCursor)
  const [hasMore,setHasMore] = useState(initialPage.hasMore)
  const [loading,setLoading] = useState(feedMode === 'following')
  const [error,setError] = useState('')
  const [requiresAuth,setRequiresAuth] = useState(false)
  const [candidateWindowTruncated,setCandidateWindowTruncated] = useState(initialPage.candidateWindowTruncated === true)
  const sentinelRef = useRef<HTMLDivElement|null>(null)
  const loadingRef = useRef(false)

  const loadInitialFollowing = useCallback(async () => {
    if (feedMode !== 'following' || loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '20' })
      const { response, data } = await fetchJson<{data?:HomeContentPage;error?:{code?:string;message?:string}}>(
        '/api/v1/feed/following?' + params.toString(),
        { headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'include' },
      )
      if (response.status === 401 || data?.error?.code === 'UNAUTHENTICATED') {
        setRequiresAuth(true)
        setItems([])
        setNextCursor(null)
        setHasMore(false)
        return
      }
      if (!response.ok || !data?.data) throw new Error(getApiErrorMessage(data, copy.feed.loadMoreError))
      const page = data.data
      setRequiresAuth(false)
      setItems(page.items ?? [])
      setNextCursor(page.nextCursor ?? null)
      setHasMore(page.hasMore === true)
      setCandidateWindowTruncated(page.candidateWindowTruncated === true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : copy.feed.loadMoreError)
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }, [copy.feed.loadMoreError, feedMode])

  const loadMore = useCallback(async () => {
    if(loadingRef.current||!hasMore||!nextCursor||requiresAuth)return
    loadingRef.current=true;setLoading(true);setError('')
    try {
      const params=new URLSearchParams({limit:'20',cursor:nextCursor})
      const endpoint = feedMode === 'following' ? '/api/v1/feed/following?' : '/api/v1/contents?'
      const {response,data}=await fetchJson<{data?:HomeContentPage;error?:{code?:string;message?:string}}>(
        endpoint + params.toString(),
        {headers:{accept:'application/json'},cache:'no-store',credentials:feedMode==='following'?'include':'omit'},
      )
      if (response.status === 401 && feedMode === 'following') {
        setRequiresAuth(true)
        setItems([])
        setNextCursor(null)
        setHasMore(false)
        return
      }
      if(!response.ok||!data?.data)throw new Error(getApiErrorMessage(data,copy.feed.loadMoreError))
      const page=data.data
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...(page.items??[]).filter(item=>!seen.has(item.id))]})
      setNextCursor(page.nextCursor??null);setHasMore(page.hasMore===true)
      setCandidateWindowTruncated(current => current || page.candidateWindowTruncated === true)
    } catch(cause) {setError(cause instanceof Error?cause.message:copy.feed.loadMoreError)}
    finally {loadingRef.current=false;setLoading(false)}
  }, [copy.feed.loadMoreError, feedMode, hasMore, nextCursor, requiresAuth])

  useEffect(() => {
    if (feedMode !== 'following') return
    let cancelled = false
    // Defer the fetch to the microtask queue; it synchronously updates loading state.
    void Promise.resolve().then(() => {
      if (!cancelled) void loadInitialFollowing()
    })
    return () => { cancelled = true }
  }, [feedMode, loadInitialFollowing])

  useEffect(()=>{
    const target=sentinelRef.current;if(!target||!hasMore)return
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMore()},{rootMargin:'500px 0px'})
    observer.observe(target);return()=>observer.disconnect()
  },[hasMore,nextCursor,feedMode,requiresAuth,loadMore])

  const followingEmptyTitle = locale === 'en'
    ? 'No posts from followed accounts yet'
    : locale === 'tw' ? '你追蹤的帳號還沒有動態' : '你关注的账号还没有动态'
  const signInTitle = locale === 'en'
    ? 'Sign in to see posts from accounts you follow'
    : locale === 'tw' ? '登入後查看你追蹤帳號的動態' : '登录后查看你关注账号的动态'
  const signInLabel = locale === 'en' ? 'Sign in' : locale === 'tw' ? '登入' : '登录'

  return <section aria-busy={loading} aria-label={copy.feed.timeline}>
    {feedMode === 'following' && candidateWindowTruncated ? <p className="border-b border-light-border px-4 py-3 text-sm text-light-secondary dark:border-dark-border dark:text-dark-secondary" role="status">{locale === 'en' ? 'This timeline currently includes the most recently followed 500 accounts; posts from older follows may be missing.' : locale === 'tw' ? '目前僅載入最近追蹤的 500 個帳號；更早追蹤的帳號可能未出現在此動態中。' : '当前仅加载最近关注的 500 个账号；更早关注的账号可能未出现在此动态中。'}</p> : null}
    {requiresAuth ? <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" role="status"><h2 className="text-xl font-bold">{signInTitle}</h2><Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href={'/login?returnTo=' + encodeURIComponent('/home?feed=following')}>{signInLabel}</Link></div> : null}
    {!requiresAuth ? items.map(item=><LuckReadSocialPostCard key={item.id} contentId={item.id} slug={item.slug} title={item.title} creatorId={item.creatorId ?? (feedMode === 'following' ? item.ownerUserId : undefined)} coverRef={item.coverRef} mediaRefs={item.mediaRefs} createdAt={item.createdAt} updatedAt={item.updatedAt} locale={locale} presentation="twitter-clone" contentType={item.contentType}/>) : null}
    {!requiresAuth&&items.length===0&&!loading&&!error?<div className="flex flex-col items-center gap-3 px-6 py-16 text-center"><h2 className="text-xl font-bold">{feedMode==='following'?followingEmptyTitle:copy.feed.noPublicContent}</h2><p className="text-sm text-light-secondary dark:text-dark-secondary">{feedMode==='following'?(locale==='en'?'Follow more accounts to build your timeline.':locale==='tw'?'追蹤更多帳號以建立你的動態。':'关注更多账号，开始建立你的动态。'):copy.feed.emptyDescription}</p><Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href="/content">{copy.feed.exploreContent}</Link></div>:null}
    {loading&&items.length===0?<div className="flex justify-center px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" role="status">{copy.feed.loading}</div>:null}
    {error?<div className="flex items-center justify-between gap-3 border-b border-light-border px-4 py-4 text-sm dark:border-dark-border" role="status"><p>{error}</p><button className="rounded-full border border-light-line-reply px-4 py-2 font-bold dark:border-dark-border" onClick={()=>feedMode==='following'&&items.length===0?void loadInitialFollowing():void loadMore()} type="button">{copy.feed.retry}</button></div>:null}
    {hasMore?<div className="flex justify-center px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" ref={sentinelRef}>{loading?copy.feed.loading:copy.feed.loadingMore}</div>:null}
  </section>
}
