'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { fetchJson, getApiErrorMessage } from '../../lib/client-api.js'
import LuckReadSocialPostCard from '../(frontend)/components/reuse/LuckReadSocialPostCard'

export type HomeContentItem = { id:string; slug?:string; creatorId?:string|null; createdAt?:string; updatedAt?:string; contentType:'article'|'post'|'video'; title:string; bodyRef?:string; mediaRefs?:string[]; coverRef?:string|null }
export type HomeContentPage = { items:HomeContentItem[]; nextCursor:string|null; hasMore:boolean }

export default function TwitterCloneHomeFeed({initialPage}:{initialPage:HomeContentPage}) {
  const [items,setItems] = useState<HomeContentItem[]>(initialPage.items)
  const [nextCursor,setNextCursor] = useState<string|null>(initialPage.nextCursor)
  const [hasMore,setHasMore] = useState(initialPage.hasMore)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const sentinelRef = useRef<HTMLDivElement|null>(null)
  const loadingRef = useRef(false)
  async function loadMore() {
    if(loadingRef.current||!hasMore||!nextCursor)return
    loadingRef.current=true;setLoading(true);setError('')
    try {
      const params=new URLSearchParams({limit:'20',cursor:nextCursor})
      const {response,data}=await fetchJson<{data?:HomeContentPage;error?:{message?:string}}>('/api/v1/contents?'+params.toString(),{headers:{accept:'application/json'},cache:'no-store',credentials:'omit'})
      if(!response.ok||!data?.data)throw new Error(getApiErrorMessage(data,'Unable to load more content.'))
      const page=data.data
      setItems(current=>{const seen=new Set(current.map(item=>item.id));return [...current,...(page.items??[]).filter(item=>!seen.has(item.id))]})
      setNextCursor(page.nextCursor??null);setHasMore(page.hasMore===true)
    } catch(cause) {setError(cause instanceof Error?cause.message:'Unable to load more content.')}
    finally {loadingRef.current=false;setLoading(false)}
  }
  useEffect(()=>{
    const target=sentinelRef.current;if(!target||!hasMore)return
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadMore()},{rootMargin:'500px 0px'})
    observer.observe(target);return()=>observer.disconnect()
  },[hasMore,nextCursor])
  return <section aria-busy={loading} aria-label="LuckRead timeline">
    {items.map(item=><LuckReadSocialPostCard key={item.id} contentId={item.id} slug={item.slug} title={item.title} creatorId={item.creatorId} coverRef={item.coverRef} mediaRefs={item.mediaRefs} createdAt={item.createdAt} updatedAt={item.updatedAt} locale="en" presentation="twitter-clone" contentType={item.contentType}/>)}
    {items.length===0?<div className="flex flex-col items-center gap-3 px-6 py-16 text-center"><h2 className="text-xl font-bold">No public content yet</h2><p className="text-sm text-light-secondary dark:text-dark-secondary">Explore available articles, discussions, and videos, or publish your first post if your account has creator access.</p><Link className="rounded-full bg-main-accent px-5 py-2 font-bold text-white" href="/content">Explore content</Link></div>:null}
    {error?<div className="flex items-center justify-between gap-3 border-b border-light-border px-4 py-4 text-sm dark:border-dark-border" role="status"><p>{error}</p><button className="rounded-full border border-light-line-reply px-4 py-2 font-bold dark:border-dark-border" onClick={()=>void loadMore()} type="button">Retry</button></div>:null}
    {hasMore?<div className="flex justify-center px-4 py-6 text-sm text-light-secondary dark:text-dark-secondary" ref={sentinelRef}>{loading?'Loading…':'Loading more as you scroll'}</div>:null}
  </section>
}
