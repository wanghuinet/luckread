/// <reference types="@cloudflare/workers-types" />

import {
  createD1RelationshipGraphReadStore,
  RelationshipGraphStoreError,
  type RelationshipGraphReadStore,
  type RelationshipGraphReadRow,
} from './relationship-graph-store.js'

export type RelationshipGraph = {
  viewerUserId: string
  targetUserId: string
  following: boolean
  followedBy: boolean
  mutualFollow: boolean
  blocked: boolean
  blockedBy: boolean
  muted: boolean
  relationshipId: string | null
  createdAt: string | null
}

export class RelationshipGraphRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

const MAX_ID = 128
const RELATIONSHIP_GRAPH_CACHE_TTL_MS = 5000
const RELATIONSHIP_GRAPH_CACHE_MAX_ENTRIES = 2048
const relationshipGraphCache = new Map<string, { value: RelationshipGraph; expiresAt: number }>()

const relationshipGraphKey = (viewerUserId: string, targetUserId: string): string => viewerUserId + '\\0' + targetUserId

const pruneRelationshipGraphCache = (): void => {
  if (relationshipGraphCache.size < RELATIONSHIP_GRAPH_CACHE_MAX_ENTRIES) return
  const oldestKey = relationshipGraphCache.keys().next().value
  if (typeof oldestKey === 'string') relationshipGraphCache.delete(oldestKey)
}

const validateUserId = (value: string): string => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new RelationshipGraphRuntimeError('VALIDATION_FAILED', 400)
  }
  return normalized
}

type RelationshipGraphDataSource = D1Database | RelationshipGraphReadStore

function resolveRelationshipGraphReadStore(source: RelationshipGraphDataSource): RelationshipGraphReadStore {
  if (typeof (source as RelationshipGraphReadStore).read === 'function') {
    return source as RelationshipGraphReadStore
  }
  return createD1RelationshipGraphReadStore(source as D1Database)
}

export async function getRelationshipGraph(
  source: RelationshipGraphDataSource,
  viewerUserId: string,
  targetUserId: string,
): Promise<RelationshipGraph> {
  const viewer = validateUserId(viewerUserId)
  const target = validateUserId(targetUserId)

  if (viewer === target) {
    return {
      viewerUserId: viewer,
      targetUserId: target,
      following: false,
      followedBy: false,
      mutualFollow: false,
      blocked: false,
      blockedBy: false,
      muted: false,
      relationshipId: null,
      createdAt: null,
    }
  }

  const cacheKey = relationshipGraphKey(viewer, target)
  const cached = relationshipGraphCache.get(cacheKey)
  if (cached) {
    if (cached.expiresAt > Date.now()) return { ...cached.value }
    relationshipGraphCache.delete(cacheKey)
  }

  let row: RelationshipGraphReadRow | null
  try {
    row = await resolveRelationshipGraphReadStore(source).read(viewer, target)
  } catch (error) {
    if (error instanceof RelationshipGraphStoreError) {
      throw new RelationshipGraphRuntimeError(error.code, error.status)
    }
    throw error
  }

  const blocked = Boolean(row?.blocked)
  const blockedBy = Boolean(row?.blocked_by)
  const relationshipVisible = !blocked && !blockedBy

  const value = {
    viewerUserId: viewer,
    targetUserId: target,
    following: relationshipVisible && Boolean(row?.following),
    followedBy: relationshipVisible && Boolean(row?.followed_by),
    mutualFollow: relationshipVisible && Boolean(row?.following) && Boolean(row?.followed_by),
    blocked,
    blockedBy,
    muted: Boolean(row?.muted),
    relationshipId: relationshipVisible ? row?.relationship_id ?? null : null,
    createdAt: relationshipVisible ? row?.created_at ?? null : null,
  }
  pruneRelationshipGraphCache()
  relationshipGraphCache.set(cacheKey, { value, expiresAt: Date.now() + RELATIONSHIP_GRAPH_CACHE_TTL_MS })
  return { ...value }
}

export const invalidateRelationshipGraph = async (viewerUserId: string, targetUserId: string): Promise<void> => {
  const viewer = viewerUserId.trim()
  const target = targetUserId.trim()
  if (!viewer || !target) return
  relationshipGraphCache.delete(relationshipGraphKey(viewer, target))
  relationshipGraphCache.delete(relationshipGraphKey(target, viewer))
}

export const clearRelationshipGraphCacheForTests = (): void => relationshipGraphCache.clear()
