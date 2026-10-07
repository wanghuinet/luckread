'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import styles from './creator-center.module.css'

type Kind = 'series' | 'collections'

type OrganizationItem = {
  id: string
  state: string
  version: number
  etag: string
  title: string
}

type MemberItem = {
  relationshipId: string
  contentId: string
  contentSlug: string
  contentType: 'article' | 'post' | 'video'
  contentState: string
  title: string
  position: number
  createdAt: string
  updatedAt: string
}

type MemberPage = {
  items: MemberItem[]
  nextCursor: string | null
  hasMore: boolean
  seriesVersion?: number
  seriesEtag?: string
  collectionVersion?: number
  collectionEtag?: string
}

type ContentCandidate = {
  id: string
  title: string
  contentType: 'article' | 'post' | 'video'
  state: string
}

type ContentCandidatePage = {
  items: ContentCandidate[]
  nextCursor: string | null
  hasMore: boolean
}

const meta: Record<Kind, {
  label: string
  path: string
  etagKey: 'seriesEtag' | 'collectionEtag'
}> = {
  series: {
    label: '系列',
    path: '/api/v1/series',
    etagKey: 'seriesEtag',
  },
  collections: {
    label: '合集',
    path: '/api/v1/collections',
    etagKey: 'collectionEtag',
  },
}

const contentTypeLabels: Record<ContentCandidate['contentType'], string> = {
  article: '文章',
  post: '动态',
  video: '视频',
}

function redirectToLogin(loginPath: '/admin/login' | '/login') {
  const returnTo = window.location.pathname + window.location.search + window.location.hash
  window.location.assign(loginPath + '?returnTo=' + encodeURIComponent(returnTo))
}

function mutationHeaders(etag: string, prefix: string): HeadersInit {
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'If-Match': etag,
    'Idempotency-Key': prefix + crypto.randomUUID(),
  }
}

export default function CreatorContentOrganizationMembers({
  kind,
  organization,
  loginPath = '/login',
  onChanged,
}: {
  kind: Kind
  organization: OrganizationItem
  loginPath?: '/admin/login' | '/login'
  onChanged: (organizationId: string, etag: string, version: number) => void
}) {
  const organizationMeta = meta[kind]
  const [members, setMembers] = useState<MemberItem[]>([])
  const [currentEtag, setCurrentEtag] = useState(organization.etag)
  const [currentVersion, setCurrentVersion] = useState(organization.version)
  const [candidates, setCandidates] = useState<ContentCandidate[]>([])
  const [candidateCursor, setCandidateCursor] = useState<string | null>(null)
  const [candidateHasMore, setCandidateHasMore] = useState(false)
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [selectedContentId, setSelectedContentId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [error, setError] = useState('')

  const editable = ['DRAFT', 'REJECTED', 'UNPUBLISHED', 'RESTORED'].includes(organization.state)

  const loadMembers = useCallback(async (signal: AbortSignal) => {
    const response = await fetch(
      organizationMeta.path + '/' + encodeURIComponent(organization.id) + '/members?limit=50',
      {
        credentials: 'include',
        headers: { accept: 'application/json' },
        cache: 'no-store',
        signal,
      },
    )
    const data = await response.json().catch((): null => null) as { data?: MemberPage } | null
    if (response.status === 401) {
      redirectToLogin(loginPath)
      throw new Error('AUTH_REQUIRED')
    }
    if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
      throw new Error(data?.data ? 'ORGANIZATION_MEMBERS_LOAD_FAILED' : '组织成员暂时无法加载。')
    }
    const page = data.data
    const nextEtag = page[organizationMeta.etagKey] ?? organization.etag
    const nextVersion = organizationMeta.etagKey === 'seriesEtag'
      ? page.seriesVersion ?? organization.version
      : page.collectionVersion ?? organization.version
    return { page, nextEtag, nextVersion }
  }, [loginPath, organization.id, organization.etag, organization.version, organizationMeta.etagKey, organizationMeta.path])

  const loadCandidates = useCallback(async (signal: AbortSignal, cursor: string | null = null) => {
    const params = new URLSearchParams({ limit: '50', status: 'PUBLISHED' })
    if (cursor) params.set('cursor', cursor)
    const response = await fetch('/api/creator/contents?' + params.toString(), {
      credentials: 'include',
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal,
    })
    const data = await response.json().catch((): null => null) as { data?: ContentCandidatePage } | null
    if (response.status === 401) {
      redirectToLogin(loginPath)
      throw new Error('AUTH_REQUIRED')
    }
    if (!response.ok || !data?.data || !Array.isArray(data.data.items)) {
      throw new Error('CONTENT_CANDIDATES_LOAD_FAILED')
    }
    return data.data
  }, [loginPath])

  useEffect(() => {
    const controller = new AbortController()
    void loadMembers(controller.signal)
      .then(({ page, nextEtag, nextVersion }) => {
        if (controller.signal.aborted) return
        setMembers(page.items)
        setCurrentEtag(nextEtag)
        setCurrentVersion(nextVersion)
        onChanged(organization.id, nextEtag, nextVersion)
        setError('')
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
        setError(cause instanceof Error ? cause.message : '组织成员暂时无法加载。')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [loadMembers, onChanged, organization.id])

  useEffect(() => {
    if (!editable) return
    const controller = new AbortController()
    void loadCandidates(controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setCandidates(page.items)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
        setError(cause instanceof Error ? cause.message : '可加入内容暂时无法加载。')
      })
    return () => controller.abort()
  }, [editable, loadCandidates])

  const memberIds = useMemo(() => new Set(members.map((item) => item.contentId)), [members])
  const availableCandidates = useMemo(
    () => candidates.filter((item) => item.state === 'PUBLISHED' && !memberIds.has(item.id)),
    [candidates, memberIds],
  )

  async function refreshMembers() {
    const controller = new AbortController()
    try {
      const { page, nextEtag, nextVersion } = await loadMembers(controller.signal)
      setMembers(page.items)
      setCurrentEtag(nextEtag)
      setCurrentVersion(nextVersion)
      onChanged(organization.id, nextEtag, nextVersion)
      setError('')
    } catch (cause) {
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
      setError(cause instanceof Error ? cause.message : '组织成员暂时无法加载。')
    } finally {
      controller.abort()
    }
  }

  async function loadMoreCandidates() {
    if (!candidateHasMore || candidateLoading || !candidateCursor) return
    setCandidateLoading(true)
    setError('')
    const controller = new AbortController()
    try {
      const page = await loadCandidates(controller.signal, candidateCursor)
      if (controller.signal.aborted) return
      setCandidates((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...page.items.filter((item) => !seen.has(item.id))]
      })
      setCandidateCursor(page.nextCursor)
      setCandidateHasMore(page.hasMore)
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof Error && cause.message === 'AUTH_REQUIRED') return
      setError(cause instanceof Error ? cause.message : '更多可加入内容暂时无法加载。')
    } finally {
      if (!controller.signal.aborted) setCandidateLoading(false)
      controller.abort()
    }
  }

  async function addMember() {
    if (!selectedContentId || !editable || busyKey) return
    setBusyKey('add')
    setError('')
    try {
      const response = await fetch(
        organizationMeta.path + '/' + encodeURIComponent(organization.id) + '/members',
        {
          method: 'POST',
          credentials: 'include',
          headers: mutationHeaders(currentEtag, 'content-organization-member:'),
          body: JSON.stringify({ contentId: selectedContentId }),
        },
      )
      const data = await response.json().catch((): null => null) as {
        error?: { message?: string }
        data?: { [key: string]: unknown }
      } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '加入失败')
      const nextEtag = typeof data.data?.[organizationMeta.etagKey] === 'string'
        ? String(data.data[organizationMeta.etagKey])
        : currentEtag
      const versionKey = kind === 'series' ? 'seriesVersion' : 'collectionVersion'
      const nextVersion = typeof data.data?.[versionKey] === 'number' ? Number(data.data[versionKey]) : currentVersion + 1
      setCurrentEtag(nextEtag)
      setCurrentVersion(nextVersion)
      onChanged(organization.id, nextEtag, nextVersion)
      setSelectedContentId('')
      await refreshMembers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '加入失败')
    } finally {
      setBusyKey(null)
    }
  }

  async function removeMember(member: MemberItem) {
    if (!editable || busyKey) return
    if (!window.confirm('确定将“' + member.title + '”移出' + organizationMeta.label + '吗？')) return
    setBusyKey('remove:' + member.contentId)
    setError('')
    try {
      const response = await fetch(
        organizationMeta.path + '/' + encodeURIComponent(organization.id) + '/members/' + encodeURIComponent(member.contentId),
        {
          method: 'DELETE',
          credentials: 'include',
          headers: mutationHeaders(currentEtag, 'content-organization-member-remove:'),
        },
      )
      const data = await response.json().catch((): null => null) as {
        error?: { message?: string }
        data?: { [key: string]: unknown }
      } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '移除失败')
      const nextEtag = typeof data.data?.[organizationMeta.etagKey] === 'string'
        ? String(data.data[organizationMeta.etagKey])
        : currentEtag
      const versionKey = kind === 'series' ? 'seriesVersion' : 'collectionVersion'
      const nextVersion = typeof data.data?.[versionKey] === 'number' ? Number(data.data[versionKey]) : currentVersion + 1
      setCurrentEtag(nextEtag)
      setCurrentVersion(nextVersion)
      onChanged(organization.id, nextEtag, nextVersion)
      await refreshMembers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '移除失败')
    } finally {
      setBusyKey(null)
    }
  }

  async function reorderMember(member: MemberItem, position: number) {
    if (!editable || busyKey || position < 0 || position >= members.length) return
    setBusyKey('move:' + member.contentId)
    setError('')
    try {
      const response = await fetch(
        organizationMeta.path + '/' + encodeURIComponent(organization.id) + '/members/' + encodeURIComponent(member.contentId),
        {
          method: 'PATCH',
          credentials: 'include',
          headers: mutationHeaders(currentEtag, 'content-organization-member-reorder:'),
          body: JSON.stringify({ position }),
        },
      )
      const data = await response.json().catch((): null => null) as {
        error?: { message?: string }
        data?: { [key: string]: unknown }
      } | null
      if (response.status === 401) {
        redirectToLogin(loginPath)
        return
      }
      if (!response.ok) throw new Error(data?.error?.message || '排序更新失败')
      const nextEtag = typeof data.data?.[organizationMeta.etagKey] === 'string'
        ? String(data.data[organizationMeta.etagKey])
        : currentEtag
      const versionKey = kind === 'series' ? 'seriesVersion' : 'collectionVersion'
      const nextVersion = typeof data.data?.[versionKey] === 'number' ? Number(data.data[versionKey]) : currentVersion + 1
      setCurrentEtag(nextEtag)
      setCurrentVersion(nextVersion)
      onChanged(organization.id, nextEtag, nextVersion)
      await refreshMembers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '排序更新失败')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className={styles.audiencePanel} aria-label={organization.title + '成员管理'}>
      <div className={styles.audienceListHeader}>
        <div>
          <strong>{organization.title} · 成员管理</strong>
          <span>{members.length} 个已加载成员，版本 v{currentVersion}</span>
        </div>
        <div className={styles.sectionActions}>
          <button className={styles.secondaryButton + ' btn'} onClick={() => void refreshMembers()} type="button" disabled={busyKey !== null}>
            刷新
          </button>
        </div>
      </div>

      {!editable ? (
        <p className={styles.audienceState}>当前 {organizationMeta.label} 状态为 {organization.state}，成员关系暂不可修改。</p>
      ) : (
        <div className={styles.contentFilters}>
          <select
            aria-label={'选择加入' + organizationMeta.label + '的已发布内容'}
            className={styles.filterSelect}
            onChange={(event) => setSelectedContentId(event.target.value)}
            value={selectedContentId}
          >
            <option value="">选择已发布内容…</option>
            {availableCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                [{contentTypeLabels[candidate.contentType]}] {candidate.title}
              </option>
            ))}
          </select>
          <button
            className={styles.primaryButton + ' btn'}
            disabled={!selectedContentId || busyKey !== null}
            onClick={() => void addMember()}
            type="button"
          >
            加入{organizationMeta.label}
          </button>
          {candidateHasMore ? (
            <button
              className={styles.secondaryButton + ' btn'}
              disabled={candidateLoading || busyKey !== null}
              onClick={() => void loadMoreCandidates()}
              type="button"
            >
              {candidateLoading ? '加载中…' : '加载更多已发布内容'}
            </button>
          ) : null}
        </div>
      )}

      {error ? <div className={styles.audienceState} role="alert">{error}</div> : null}
      {loading ? <p className={styles.audienceState} role="status">正在加载成员…</p> : null}

      {!loading && members.length === 0 ? (
        <div className={styles.contentManageEmpty}>
          <strong>还没有成员</strong>
          <span>可从上方已发布内容中选择内容加入。</span>
        </div>
      ) : null}

      {!loading && members.length > 0 ? (
        <div className={styles.audienceList}>
          {members.map((member, index) => (
            <article className={styles.contentListItem} key={member.relationshipId}>
              <div className={styles.contentListMain}>
                <div className={styles.contentMeta}>
                  <span>{contentTypeLabels[member.contentType]}</span>
                  <span>{member.contentState}</span>
                  <span>位置 {index + 1}</span>
                </div>
                <h3>{member.title}</h3>
                <span className={styles.contentMediaHint}>contentId: {member.contentId}</span>
              </div>
              <div className={styles.contentListActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={!editable || busyKey !== null || index === 0}
                  onClick={() => void reorderMember(member, index - 1)}
                  type="button"
                >
                  上移
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={!editable || busyKey !== null || index === members.length - 1}
                  onClick={() => void reorderMember(member, index + 1)}
                  type="button"
                >
                  下移
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={!editable || busyKey !== null}
                  onClick={() => void removeMember(member)}
                  type="button"
                >
                  {busyKey === 'remove:' + member.contentId ? '处理中…' : '移除'}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
