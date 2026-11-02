/// <reference types="@cloudflare/workers-types" />
import { fetchPublishedContentSocialContexts, type PublishedContentSocialContext, type W03ContentBinding } from './w03-content-context-client.js'

export class SocialClosureRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code) }
}

export type SocialTargetType = 'content' | 'comment'
export type SocialNotificationType = 'FOLLOW' | 'LIKE' | 'COMMENT' | 'REPLY' | 'MENTION'

export type SocialToken = {
  kind: 'mention' | 'hashtag'
  value: string
  normalized: string
}

const MAX_ID = 128
const MAX_TEXT = 10000
const MAX_LIMIT = 50
const DEFAULT_LIMIT = 20
const MAX_CURSOR = 2048

const DISCOVERY_TOPIC_RANKING_CACHE_TTL_SECONDS = 15
// Bound cold-cache memory while retaining recently reused content contexts.
const DISCOVERY_TOPIC_CONTEXT_CACHE_MAX_ENTRIES = 5000
type RankedDiscoveryTopic = {
  topicId: string
  name: string
  displayName: string
  contentCount: number
  latestContentAt: string
}

const compareText = (left: string, right: string): number => {
  const leftPoints = Array.from(left, character => character.codePointAt(0)!)
  const rightPoints = Array.from(right, character => character.codePointAt(0)!)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!
  }
  return leftPoints.length - rightPoints.length
}


const getSocialDefaultCache = (): Cache | null => {
  if (typeof globalThis.caches === 'undefined') return null
  return (globalThis.caches as unknown as { default?: Cache }).default ?? null
}

const discoveryTopicRankingCacheKey = (): Request =>
  new Request('https://cache.luckread.internal/__social-discovery-topics-ranking?v=1', { method: 'GET' })

const readCachedDiscoveryTopicRanking = async (): Promise<RankedDiscoveryTopic[] | null> => {
  const cache = getSocialDefaultCache()
  if (!cache) return null
  try {
    const response = await cache.match(discoveryTopicRankingCacheKey())
    if (!response) return null
    const value = await response.json() as unknown
    if (!Array.isArray(value) || value.length > 10000) return null
    const items: RankedDiscoveryTopic[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const row = item as Partial<RankedDiscoveryTopic>
      if (
        typeof row.topicId !== 'string' ||
        !/^[A-Za-z0-9][\p{L}\p{N}_-]{0,127}$/u.test(row.topicId) ||
        typeof row.name !== 'string' ||
        typeof row.displayName !== 'string' ||
        typeof row.contentCount !== 'number' ||
        !Number.isSafeInteger(row.contentCount) ||
        row.contentCount < 1 ||
        typeof row.latestContentAt !== 'string' ||
        !Number.isFinite(Date.parse(row.latestContentAt))
      ) return null
      items.push({
        topicId: row.topicId,
        name: row.name,
        displayName: row.displayName,
        contentCount: row.contentCount,
        latestContentAt: row.latestContentAt,
      })
    }
    return items
  } catch {
    return null
  }
}

const writeCachedDiscoveryTopicRanking = async (items: RankedDiscoveryTopic[]): Promise<void> => {
  const cache = getSocialDefaultCache()
  if (!cache || items.length > 10000) return
  try {
    await cache.put(
      discoveryTopicRankingCacheKey(),
      Response.json(items, {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'public, max-age=0, s-maxage=' + DISCOVERY_TOPIC_RANKING_CACHE_TTL_SECONDS,
        },
      }),
    )
  } catch {
    // Discovery stays correct if the optional edge cache is unavailable.
  }
}
const tokenPattern = /(^|[\s([{"'“‘，。！？；：、])([@#])([\p{L}\p{N}_]{1,64})/gu

const id = (value: string, code: 'VALIDATION_FAILED' | 'UNAUTHENTICATED' = 'VALIDATION_FAILED') => {
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_ID) {
    throw new SocialClosureRuntimeError(code, code === 'UNAUTHENTICATED' ? 401 : 400)
  }
  return normalized
}

const target = (targetTypeValue: string, targetIdValue: string): { targetType: SocialTargetType; targetId: string } => {
  if (targetTypeValue !== 'content' && targetTypeValue !== 'comment') {
    throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
  }
  return { targetType: targetTypeValue, targetId: id(targetIdValue) }
}

const parseLimit = (value: string | null): number => {
  if (!value || !value.trim()) return DEFAULT_LIMIT
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
  }
  return n
}

const encodeCursor = (createdAt: string, notificationId: string): string =>
  btoa(JSON.stringify({ v: 1, createdAt, notificationId }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const decodeCursor = (value: string | null): { createdAt: string; notificationId: string } | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR) {
    throw new SocialClosureRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') +
      '='.repeat((4 - normalized.length % 4) % 4)
    const parsed = JSON.parse(atob(padded)) as { v?: number; createdAt?: unknown; notificationId?: unknown }
    if (parsed.v !== 1 || typeof parsed.createdAt !== 'string' || typeof parsed.notificationId !== 'string') {
      throw new Error('invalid cursor')
    }
    return { createdAt: parsed.createdAt, notificationId: parsed.notificationId }
  } catch {
    throw new SocialClosureRuntimeError('INVALID_CURSOR', 400)
  }
}

export const extractSocialTokens = (input: string): SocialToken[] => {
  const source = input.normalize('NFKC')
  const tokens: SocialToken[] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(tokenPattern)) {
    const prefix = match[2]
    const raw = match[3]
    const normalized = raw.normalize('NFKC').toLocaleLowerCase('en-US')
    const key = prefix + normalized
    if (seen.has(key)) continue
    seen.add(key)
    tokens.push({ kind: prefix === '@' ? 'mention' : 'hashtag', value: prefix + raw, normalized })
  }
  return tokens
}

const assertTargetPublished = async (
  db: D1Database,
  targetValue: { targetType: SocialTargetType; targetId: string },
  actorUserId: string,
  contentContext?: PublishedContentSocialContext,
): Promise<void> => {
  if (targetValue.targetType === 'content') {
    if (!contentContext) {
      throw new SocialClosureRuntimeError('SERVICE_UNAVAILABLE', 503)
    }
    if (
      contentContext.contentId !== targetValue.targetId ||
      contentContext.state !== 'PUBLISHED'
    ) {
      throw new SocialClosureRuntimeError('NOT_FOUND', 404)
    }
    if (contentContext.ownerUserId !== actorUserId) {
      throw new SocialClosureRuntimeError('PERMISSION_DENIED', 403)
    }
    return
  }

  const row = await db.prepare(
    'SELECT author_user_id, state FROM social_comments WHERE id = ? LIMIT 1',
  ).bind(targetValue.targetId).first<{ author_user_id: string; state: string }>()
  if (!row || row.state !== 'PUBLISHED') throw new SocialClosureRuntimeError('NOT_FOUND', 404)
  if (row.author_user_id !== actorUserId) throw new SocialClosureRuntimeError('PERMISSION_DENIED', 403)
}

export type MentionTarget = { userId: string; handle: string }

export async function syncSocialTokens(
  db: D1Database,
  actorUserIdValue: string,
  targetTypeValue: string,
  targetIdValue: string,
  textValue: string,
  mentions: MentionTarget[] = [],
  contentContext?: PublishedContentSocialContext,
): Promise<{ topics: number; mentions: number }> {
  const actorUserId = id(actorUserIdValue, 'UNAUTHENTICATED')
  const targetValue = target(targetTypeValue, targetIdValue)
  const text = textValue.normalize('NFKC').trim()
  if (text.length > MAX_TEXT) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)

  await assertTargetPublished(db, targetValue, actorUserId, contentContext)
  const relatedContent = targetValue.targetType === 'comment'
    ? await db.prepare(
        "SELECT content_id FROM social_comments WHERE id = ? AND state = 'PUBLISHED' LIMIT 1",
      ).bind(targetValue.targetId).first<{ content_id: string }>()
    : null
  const relatedContentId = relatedContent?.content_id ?? null
  const tokens = extractSocialTokens(text)
  const now = new Date().toISOString()
  const previousMentions = await db.prepare(
    `SELECT mentioned_user_id, handle
       FROM social_mentions
      WHERE target_type = ? AND target_id = ?`,
  ).bind(targetValue.targetType, targetValue.targetId).all<{
    mentioned_user_id: string
    handle: string
  }>()
  const previousByHandle = new Map<string, MentionTarget | null>()
  for (const row of previousMentions.results ?? []) {
    const normalizedHandle = row.handle.trim().replace(/^[@＠]/, '').normalize('NFKC').toLocaleLowerCase('en-US')
    if (!normalizedHandle) continue
    const previous = previousByHandle.get(normalizedHandle)
    if (previous && previous.userId !== row.mentioned_user_id) {
      previousByHandle.set(normalizedHandle, null)
    } else if (!previousByHandle.has(normalizedHandle)) {
      previousByHandle.set(normalizedHandle, {
        userId: id(row.mentioned_user_id),
        handle: row.handle,
      })
    }
  }

  await db.batch([
    db.prepare('DELETE FROM social_target_topics WHERE target_type = ? AND target_id = ?').bind(targetValue.targetType, targetValue.targetId),
    db.prepare('DELETE FROM social_mentions WHERE target_type = ? AND target_id = ?').bind(targetValue.targetType, targetValue.targetId),
  ])

  const topics = tokens.filter((token) => token.kind === 'hashtag')
  for (const token of topics) {
    const topicId = 'topic_' + token.normalized
    await db.prepare(
      `INSERT INTO social_topics (topic_id, normalized_name, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?)
       ON CONFLICT(normalized_name)
       DO UPDATE SET updated_at = excluded.updated_at`,
    ).bind(topicId, token.normalized, token.normalized, now, now).run()

    await db.prepare(
      `INSERT OR IGNORE INTO social_target_topics
        (relation_id, target_type, target_id, topic_id, token, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), targetValue.targetType, targetValue.targetId, topicId, token.value, now).run()
  }

  const resolved = new Map<string, MentionTarget>()
  for (const entry of mentions) {
    const handle = entry.handle.trim().replace(/^@/, '')
    if (!handle) continue
    // Match the same NFKC + en-US lowercase normalization used by extracted tokens.
    const normalizedHandle = handle.normalize('NFKC').toLocaleLowerCase('en-US')
    resolved.set(normalizedHandle, { userId: id(entry.userId), handle })
  }

  let mentionCount = 0
  for (const token of tokens.filter((item) => item.kind === 'mention')) {
    // An edit must not rebind an unchanged historical @handle to a new account
    // after the old username has been reclaimed. Keep the stored identity for
    // handles already attached to this target; resolve only newly introduced handles.
    const previous = previousByHandle.get(token.normalized)
    const entry = previous === undefined ? resolved.get(token.normalized) : previous ?? undefined
    if (!entry || entry.userId === actorUserId) continue
    await db.prepare(
      `INSERT OR IGNORE INTO social_mentions
        (mention_id, target_type, target_id, actor_user_id, mentioned_user_id, handle, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      targetValue.targetType,
      targetValue.targetId,
      actorUserId,
      entry.userId,
      entry.handle,
      now,
    ).run()

    await enqueueNotification(db, {
      recipientUserId: entry.userId,
      actorUserId,
      type: 'MENTION',
      targetType: targetValue.targetType,
      targetId: targetValue.targetId,
      payload: {
        handle: entry.handle,
        ...(relatedContentId ? { contentId: relatedContentId } : {}),
      },
    })
    mentionCount += 1
  }

  return { topics: topics.length, mentions: mentionCount }
}

export async function getSocialTargets(
  db: D1Database,
  targetTypeValue: string,
  targetIdValue: string,
): Promise<{
  topics: Array<{ topicId: string; name: string; displayName: string }>
  mentions: Array<{ userId: string; handle: string }>
}> {
  const targetValue = target(targetTypeValue, targetIdValue)
  const topics = await db.prepare(
    `SELECT t.topic_id, t.normalized_name, t.display_name
       FROM social_target_topics st
       JOIN social_topics t ON t.topic_id = st.topic_id
      WHERE st.target_type = ? AND st.target_id = ? AND t.status = 'ACTIVE'
      ORDER BY st.created_at ASC
      LIMIT 50`,
  ).bind(targetValue.targetType, targetValue.targetId).all<{ topic_id: string; normalized_name: string; display_name: string }>()

  const mentions = await db.prepare(
    `SELECT mentioned_user_id, handle
       FROM social_mentions
      WHERE target_type = ? AND target_id = ?
      ORDER BY created_at ASC
      LIMIT 100`,
  ).bind(targetValue.targetType, targetValue.targetId).all<{ mentioned_user_id: string; handle: string }>()

  return {
    topics: (topics.results ?? []).map((row) => ({
      topicId: row.topic_id,
      name: row.normalized_name,
      displayName: row.display_name,
    })),
    mentions: (mentions.results ?? []).map((row) => ({
      userId: row.mentioned_user_id,
      handle: row.handle,
    })),
  }
}

export async function getTopicPage(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  topicNameValue: string,
  limitValue: string | null,
  cursorValue: string | null = null,
  correlationId = '',
): Promise<{
  topic: { topicId: string; name: string; displayName: string; status: string }
  contents: Array<{ id: string; contentType: string; title: string; updatedAt: string }>
  hasMore: boolean
  nextCursor: string | null
}> {
  const normalizedName = topicNameValue.trim().replace(/^#/, '').normalize('NFKC').toLocaleLowerCase('en-US')
  if (!normalizedName || normalizedName.length > 64) {
    throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
  }
  if (!correlationId.trim()) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)

  const limit = parseLimit(limitValue)
  const cursor = cursorValue ? decodeCursor(cursorValue) : null
  const topic = await db.prepare(
    'SELECT topic_id, normalized_name, display_name, status FROM social_topics WHERE normalized_name = ? LIMIT 1',
  ).bind(normalizedName).first<{ topic_id: string; normalized_name: string; display_name: string; status: string }>()
  if (!topic || topic.status !== 'ACTIVE') throw new SocialClosureRuntimeError('NOT_FOUND', 404)

  // W05 pages its own topic edges in bounded batches. W03 remains authoritative
  // for published state, type, title and update time; stale edges never leak.
  const batchSize = 50
  const maxBatches = 4
  let scanCursor = cursor ? { createdAt: cursor.createdAt, targetId: cursor.notificationId } : null
  let lastScanned: { createdAt: string; targetId: string } | null = null
  let sourceExhausted = false
  let batchesScanned = 0
  const visible: Array<{
    id: string
    contentType: string
    title: string
    updatedAt: string
    topicCreatedAt: string
  }> = []

  while (batchesScanned < maxBatches && visible.length <= limit && !sourceExhausted) {
    const where = scanCursor
      ? ' AND (st.created_at < ? OR (st.created_at = ? AND st.target_id < ?))'
      : ''
    const binds = scanCursor
      ? [topic.topic_id, scanCursor.createdAt, scanCursor.createdAt, scanCursor.targetId, batchSize]
      : [topic.topic_id, batchSize]
    const candidates = await db.prepare(
      `SELECT st.target_id, st.created_at
         FROM social_target_topics st
        WHERE st.target_type = 'content'
          AND st.topic_id = ?${where}
        ORDER BY st.created_at DESC, st.target_id DESC
        LIMIT ?`,
    ).bind(...binds).all<{ target_id: string; created_at: string }>()
    const rows = candidates.results ?? []
    batchesScanned += 1
    if (rows.length === 0) {
      sourceExhausted = true
      break
    }

    const last = rows.at(-1)!
    lastScanned = { createdAt: last.created_at, targetId: last.target_id }
    scanCursor = lastScanned
    if (rows.length < batchSize) sourceExhausted = true

    const contexts = await fetchPublishedContentSocialContexts(w03Content, {
      contentIds: rows.map(row => row.target_id),
      correlationId,
    })
    for (const row of rows) {
      const context = contexts.get(row.target_id)
      if (!context) continue
      if (typeof context.title !== 'string') {
        throw new SocialClosureRuntimeError('SERVICE_UNAVAILABLE', 503)
      }
      visible.push({
        id: context.contentId,
        contentType: context.contentType,
        title: context.title,
        updatedAt: context.updatedAt,
        topicCreatedAt: row.created_at,
      })
    }
  }

  const hasExtra = visible.length > limit
  const page = visible.slice(0, limit)
  const lastVisible = page.at(-1)
  const hasMore = hasExtra || (!sourceExhausted && batchesScanned >= maxBatches && lastScanned !== null)
  const cursorAnchor = hasExtra
    ? lastVisible
    : hasMore && lastScanned
      ? { topicCreatedAt: lastScanned.createdAt, id: lastScanned.targetId }
      : null

  return {
    topic: {
      topicId: topic.topic_id,
      name: topic.normalized_name,
      displayName: topic.display_name,
      status: topic.status,
    },
    contents: page.map(({ topicCreatedAt: _topicCreatedAt, ...content }) => content),
    hasMore,
    nextCursor: cursorAnchor ? encodeCursor(cursorAnchor.topicCreatedAt, cursorAnchor.id) : null,
  }
}


type DiscoveryTopicCursor = {
  version: 1
  contentCount: number
  latestContentAt: string
  topicId: string
}

const encodeDiscoveryTopicCursor = (cursor: DiscoveryTopicCursor): string => {
  // btoa accepts a binary string, not arbitrary Unicode JSON. Encode UTF-8
  // bytes first so international topic IDs remain valid in opaque cursors.
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const decodeDiscoveryTopicCursor = (value: string | null): DiscoveryTopicCursor | null => {
  if (!value) return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_CURSOR || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new SocialClosureRuntimeError('INVALID_CURSOR', 400)
  }
  try {
    const padded = normalized.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - normalized.length % 4) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<DiscoveryTopicCursor>
    if (
      parsed.version !== 1 ||
      typeof parsed.contentCount !== 'number' ||
      !Number.isSafeInteger(parsed.contentCount) ||
      parsed.contentCount < 1 ||
      typeof parsed.latestContentAt !== 'string' ||
      !Number.isFinite(Date.parse(parsed.latestContentAt)) ||
      typeof parsed.topicId !== 'string' ||
      !/^[A-Za-z0-9][\p{L}\p{N}_-]{0,127}$/u.test(parsed.topicId)
    ) {
      throw new Error('invalid discovery topic cursor')
    }
    return {
      version: 1,
      contentCount: parsed.contentCount,
      latestContentAt: parsed.latestContentAt,
      topicId: parsed.topicId,
    }
  } catch {
    throw new SocialClosureRuntimeError('INVALID_CURSOR', 400)
  }
}

/**
 * Returns active topics connected to public, published content updated in the
 * last seven days. This is a bounded discovery projection over W05's canonical
 * topic relations; search ranking and canonical content state remain elsewhere.
 */
export async function listDiscoveryTopics(
  db: D1Database,
  w03Content: W03ContentBinding | undefined,
  correlationId: string,
  limitValue: string | null,
  cursorValue: string | null,
): Promise<{
  items: Array<{ topicId: string; name: string; displayName: string; contentCount: number; latestContentAt: string }>
  hasMore: boolean
  nextCursor: string | null
}> {
  const limit = parseLimit(limitValue)
  const cursor = decodeDiscoveryTopicCursor(cursorValue)
  if (!correlationId.trim()) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)

  // W05 owns topic relations, but W03 owns publication status and updatedAt.
  // Enumerate W05-owned topic/content edges in bounded keyset pages, resolve
  // their canonical content context in batches of at most 50, and aggregate
  // only W03-confirmed published content inside the original seven-day window.
  let ranked: RankedDiscoveryTopic[] | null = await readCachedDiscoveryTopicRanking()
  if (ranked === null) {
  const relationBatchSize = 200
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  // Ranking needs only publication's canonical update timestamp. Do not
  // retain W03 owner/type/title payloads in the long-lived LRU.
  const contextCache = new Map<string, string | null>()
  const rememberContext = (contentId: string, updatedAt: string | null) => {
    contextCache.delete(contentId)
    contextCache.set(contentId, updatedAt)
    while (contextCache.size > DISCOVERY_TOPIC_CONTEXT_CACHE_MAX_ENTRIES) {
      const oldestContentId = contextCache.keys().next().value
      if (oldestContentId === undefined) break
      contextCache.delete(oldestContentId)
    }
  }
  const getRememberedContext = (contentId: string): string | null | undefined => {
    if (!contextCache.has(contentId)) return undefined
    const updatedAt = contextCache.get(contentId) ?? null
    // Map insertion order is used as an inexpensive LRU recency queue.
    contextCache.delete(contentId)
    contextCache.set(contentId, updatedAt)
    return updatedAt
  }
  const stats = new Map<string, RankedDiscoveryTopic>()
  type DiscoveryTopicRelation = { topic_id: string; normalized_name: string; display_name: string; target_id: string }
  let relationCursor: { topicId: string; targetId: string } | null = null

  while (true) {
    const cursorClause: string = relationCursor
      ? 'AND (st.topic_id, st.target_id) > (?, ?)'
      : ''
    const cursorBindings: string[] = relationCursor
      ? [relationCursor.topicId, relationCursor.targetId]
      : []
    // The partial covering index returns only content edges in ranking order.
    // CROSS JOIN fixes the loop order; the tuple cursor lets SQLite seek into
    // the composite index without DISTINCT or a temporary ORDER BY b-tree.
    const result: { results?: DiscoveryTopicRelation[] | null } = await db.prepare(`
      SELECT t.topic_id, t.normalized_name, t.display_name, st.target_id
        FROM social_target_topics st
          INDEXED BY ix_social_target_topics_content_topic_target
        CROSS JOIN social_topics t
       WHERE st.target_type = 'content'
         AND t.topic_id = st.topic_id
         AND t.status = 'ACTIVE'
         ${cursorClause}
       ORDER BY st.topic_id ASC, st.target_id ASC
       LIMIT ?
    `).bind(...cursorBindings, relationBatchSize).all<DiscoveryTopicRelation>()
    const edges: DiscoveryTopicRelation[] = result.results ?? []
    if (edges.length === 0) break

    const last: DiscoveryTopicRelation = edges[edges.length - 1]!
    relationCursor = { topicId: last.topic_id, targetId: last.target_id }

    // Keep this bounded relation batch's resolved context separate from the
    // global LRU: adding new entries may evict an older context also referenced
    // by this same batch before the aggregation loop reads it.
    const batchContexts = new Map<string, string | null>()
    for (const contentId of new Set(edges.map(edge => edge.target_id))) {
      const remembered = getRememberedContext(contentId)
      if (remembered !== undefined) batchContexts.set(contentId, remembered)
    }
    const unresolved: string[] = Array.from(new Set<string>(edges
      .map((edge: DiscoveryTopicRelation) => edge.target_id)
      .filter((contentId: string) => !batchContexts.has(contentId))))

    for (let offset = 0; offset < unresolved.length; offset += 50) {
      const contentIds = unresolved.slice(offset, offset + 50)
      const contexts = await fetchPublishedContentSocialContexts(w03Content, {
        contentIds,
        correlationId,
      })
      for (const contentId of contentIds) {
        const updatedAt = contexts.get(contentId)?.updatedAt ?? null
        batchContexts.set(contentId, updatedAt)
        rememberContext(contentId, updatedAt)
      }
    }

    for (const edge of edges) {
      const updatedAt = batchContexts.get(edge.target_id)
      if (!updatedAt) continue
      const updatedAtMs = Date.parse(updatedAt)
      // SQLite julianday(..., '-7 days') excludes unparseable timestamps.
      if (!Number.isFinite(updatedAtMs) || updatedAtMs < cutoff) continue

      const current = stats.get(edge.topic_id)
      if (!current) {
        stats.set(edge.topic_id, {
          topicId: edge.topic_id,
          name: edge.normalized_name,
          displayName: edge.display_name,
          contentCount: 1,
          latestContentAt: updatedAt,
        })
      } else {
        current.contentCount += 1
        // Match SQLite MAX(text) and the established lexical sort contract.
        if (updatedAt > current.latestContentAt) current.latestContentAt = updatedAt
      }
    }

    if (edges.length < relationBatchSize) break
  }

  // Match SQLite's BINARY text ordering for Unicode topic IDs. JavaScript's
  // default string comparison orders UTF-16 code units, which differs for
  // supplementary-plane letters that valid hashtag tokens can contain.
  ranked = [...stats.values()].sort((a, b) =>
    b.contentCount - a.contentCount ||
    compareText(b.latestContentAt, a.latestContentAt) ||
    compareText(a.topicId, b.topicId),
  )
  await writeCachedDiscoveryTopicRanking(ranked)
  }
  const rankedItems: RankedDiscoveryTopic[] = ranked ?? []
  const afterCursor = cursor
    ? rankedItems.filter(item =>
        item.contentCount < cursor.contentCount ||
        (item.contentCount === cursor.contentCount && (
          compareText(item.latestContentAt, cursor.latestContentAt) < 0 ||
          (compareText(item.latestContentAt, cursor.latestContentAt) === 0 && compareText(item.topicId, cursor.topicId) > 0)
        )),
      )
    : rankedItems
  const visible = afterCursor.slice(0, limit)
  const lastVisible = visible.at(-1)
  const hasMore = afterCursor.length > limit
  return {
    items: visible,
    hasMore,
    nextCursor: hasMore && lastVisible
      ? encodeDiscoveryTopicCursor({
          version: 1,
          contentCount: lastVisible.contentCount,
          latestContentAt: lastVisible.latestContentAt,
          topicId: lastVisible.topicId,
        })
      : null,
  }
}

const NOTIFICATION_DB_RETRY_DELAYS_MS = [25, 75] as const

/**
 * Retry only errors that indicate temporary contention or transport failure.
 * Permanent SQL/schema/constraint failures are not made more expensive by
 * repeating the whole notification attempt.
 */
const isTransientNotificationDbError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /\b(?:SQLITE_BUSY|SQLITE_LOCKED|database is locked|temporar(?:y|ily)|timed?\s*out|timeout|connection (?:reset|closed|lost)|network (?:error|failure)|fetch failed|service unavailable|upstream unavailable)\b/i.test(message)
}

/**
 * Retry the complete inbox-write attempt for transient D1 errors. The operation
 * reuses one notification ID and one unique dedupe key across attempts, so an
 * ambiguous first-write result cannot create duplicate inbox notifications.
 * This is bounded in-request recovery, not a substitute for a durable Queue.
 */
const withNotificationDbRetry = async <T>(operation: () => Promise<T>): Promise<T> => {
  let lastError: unknown
  for (let attempt = 0; attempt <= NOTIFICATION_DB_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransientNotificationDbError(error)) throw error
      lastError = error
      const delay = NOTIFICATION_DB_RETRY_DELAYS_MS[attempt]
      if (delay !== undefined) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delay))
      }
    }
  }
  throw lastError
}

export async function enqueueNotification(
  db: D1Database,
  input: {
    recipientUserId: string
    actorUserId: string
    type: SocialNotificationType
    targetType: 'user' | 'content' | 'comment'
    targetId: string
    payload?: Record<string, unknown>
  },
): Promise<void> {
  try {
    const recipientUserId = id(input.recipientUserId)
    const actorUserId = id(input.actorUserId, 'UNAUTHENTICATED')
    const targetId = id(input.targetId)
    if (recipientUserId === actorUserId) return

    const dedupeKey = [input.type, recipientUserId, actorUserId, input.targetType, targetId].join(':')
    const notificationId = crypto.randomUUID()
    const payloadJson = JSON.stringify(input.payload ?? {})
    const now = new Date().toISOString()

    await withNotificationDbRetry(async () => {
      const blocked = await db.prepare(
        `SELECT 1 FROM social_user_interactions
          WHERE relation_type = 'block'
            AND (
              (actor_user_id = ? AND target_user_id = ?)
              OR (actor_user_id = ? AND target_user_id = ?)
            )
          LIMIT 1`,
      ).bind(actorUserId, recipientUserId, recipientUserId, actorUserId).first()
      if (blocked) return

      const preferenceColumn = ({
        FOLLOW: 'follow_enabled',
        LIKE: 'like_enabled',
        COMMENT: 'comment_enabled',
        REPLY: 'comment_enabled',
        MENTION: 'mention_enabled',
      } as const)[input.type]

      const preference = await db.prepare(
        'SELECT ' + preferenceColumn + ' AS enabled FROM social_notification_preferences WHERE user_id = ? LIMIT 1',
      ).bind(recipientUserId).first<{ enabled: number }>()
      if (preference && Number(preference.enabled) === 0) return

      await db.prepare(
        `INSERT OR IGNORE INTO social_notifications
          (notification_id, recipient_user_id, actor_user_id, notification_type, target_type, target_id, dedupe_key, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        notificationId,
        recipientUserId,
        actorUserId,
        input.type,
        input.targetType,
        targetId,
        dedupeKey,
        payloadJson,
        now,
      ).run()
    })
  } catch (error) {
    // Notifications are a non-authoritative social side effect. A bounded
    // retry exhaustion must never roll back a successful follow/like/comment.
    // Keep logs free of user IDs, target IDs, payload data and DB messages.
    console.warn('W05_SOCIAL_NOTIFICATION_WRITE_FAILED', {
      type: input.type,
      targetType: input.targetType,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
  }
}

const NOTIFICATION_TYPES: readonly SocialNotificationType[] = ['FOLLOW', 'LIKE', 'COMMENT', 'REPLY', 'MENTION']

export async function listNotifications(
  db: D1Database,
  recipientUserIdValue: string,
  cursorValue: string | null,
  limitValue: string | null,
  typeValue: string | null = null,
) {
  const recipientUserId = id(recipientUserIdValue, 'UNAUTHENTICATED')
  const limit = parseLimit(limitValue)
  const cursor = decodeCursor(cursorValue)
  const typeText = typeValue?.trim() ?? ''
  const notificationType = typeText ? typeText : null
  if (notificationType && !NOTIFICATION_TYPES.includes(notificationType as SocialNotificationType)) {
    throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)
  }
  const whereType = notificationType ? ' AND notification_type = ?' : ''
  const whereCursor = cursor ? ' AND (created_at < ? OR (created_at = ? AND notification_id < ?))' : ''
  const cursorBinds = cursor ? [cursor.createdAt, cursor.createdAt, cursor.notificationId] : []
  const binds = [
    recipientUserId,
    ...(notificationType ? [notificationType] : []),
    ...cursorBinds,
    limit + 1,
  ]

  const rows = await db.prepare(
    `SELECT notification_id, notification_type, actor_user_id, target_type, target_id, payload_json, read_at, created_at
       FROM social_notifications
      WHERE recipient_user_id = ?${whereType}${whereCursor}
      ORDER BY created_at DESC, notification_id DESC
      LIMIT ?`,
  ).bind(...binds).all<{
    notification_id: string
    notification_type: SocialNotificationType
    actor_user_id: string
    target_type: string
    target_id: string
    payload_json: string
    read_at: string | null
    created_at: string
  }>()

  const unread = await db.prepare(
    'SELECT COUNT(*) AS count FROM social_notifications WHERE recipient_user_id = ? AND read_at IS NULL',
  ).bind(recipientUserId).first<{ count: number }>()

  const items = rows.results ?? []
  const visible = items.slice(0, limit)
  const last = visible.at(-1)
  return {
    items: visible.map((row) => ({
      id: row.notification_id,
      type: row.notification_type,
      actorUserId: row.actor_user_id,
      targetType: row.target_type,
      targetId: row.target_id,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      readAt: row.read_at,
      createdAt: row.created_at,
    })),
    unreadCount: Number(unread?.count ?? 0),
    hasMore: items.length > limit,
    nextCursor: items.length > limit && last ? encodeCursor(last.created_at, last.notification_id) : null,
  }
}

export async function markNotificationRead(
  db: D1Database,
  recipientUserIdValue: string,
  notificationIdValue: string,
): Promise<void> {
  const recipientUserId = id(recipientUserIdValue, 'UNAUTHENTICATED')
  const notificationId = id(notificationIdValue)
  await db.prepare(
    'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE notification_id = ? AND recipient_user_id = ?',
  ).bind(notificationId, recipientUserId).run()
}

export async function markAllNotificationsRead(db: D1Database, recipientUserIdValue: string): Promise<void> {
  const recipientUserId = id(recipientUserIdValue, 'UNAUTHENTICATED')
  await db.prepare(
    'UPDATE social_notifications SET read_at = CURRENT_TIMESTAMP WHERE recipient_user_id = ? AND read_at IS NULL',
  ).bind(recipientUserId).run()
}

export async function getNotificationPreferences(db: D1Database, userIdValue: string) {
  const userId = id(userIdValue, 'UNAUTHENTICATED')
  const row = await db.prepare(
    'SELECT follow_enabled, like_enabled, comment_enabled, mention_enabled FROM social_notification_preferences WHERE user_id = ? LIMIT 1',
  ).bind(userId).first<{ follow_enabled: number; like_enabled: number; comment_enabled: number; mention_enabled: number }>()
  return {
    follow: Number(row?.follow_enabled ?? 1) === 1,
    like: Number(row?.like_enabled ?? 1) === 1,
    comment: Number(row?.comment_enabled ?? 1) === 1,
    mention: Number(row?.mention_enabled ?? 1) === 1,
  }
}

export async function setNotificationPreferences(
  db: D1Database,
  userIdValue: string,
  input: Partial<{ follow: boolean; like: boolean; comment: boolean; mention: boolean }>,
) {
  const userId = id(userIdValue, 'UNAUTHENTICATED')
  const current = await getNotificationPreferences(db, userId)
  const next = {
    follow: input.follow === undefined ? current.follow : Boolean(input.follow),
    like: input.like === undefined ? current.like : Boolean(input.like),
    comment: input.comment === undefined ? current.comment : Boolean(input.comment),
    mention: input.mention === undefined ? current.mention : Boolean(input.mention),
  }
  await db.prepare(
    `INSERT INTO social_notification_preferences
      (user_id, follow_enabled, like_enabled, comment_enabled, mention_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET
       follow_enabled = excluded.follow_enabled,
       like_enabled = excluded.like_enabled,
       comment_enabled = excluded.comment_enabled,
       mention_enabled = excluded.mention_enabled,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    userId,
    next.follow ? 1 : 0,
    next.like ? 1 : 0,
    next.comment ? 1 : 0,
    next.mention ? 1 : 0,
  ).run()
  return next
}

export async function getContentSocialSummary(
  db: D1Database,
  contentIdValue: string,
  contentContext: PublishedContentSocialContext,
  viewerUserIdValue?: string | null,
) {
  const contentId = id(contentIdValue)
  if (
    contentContext.contentId !== contentId ||
    contentContext.state !== 'PUBLISHED'
  ) {
    throw new SocialClosureRuntimeError('NOT_FOUND', 404)
  }
  if (!['article', 'post', 'video'].includes(contentContext.contentType)) {
    throw new SocialClosureRuntimeError('INTERNAL_ERROR', 500)
  }

  const pinnedOwnerUserId = contentContext.contentType === 'post'
    ? contentContext.ownerUserId
    : null
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM interaction_likes WHERE target_type = 'content' AND target_id = ?) AS likes,
       (SELECT COUNT(*) FROM social_comments WHERE content_id = ? AND state = 'PUBLISHED') AS comments,
       (SELECT COUNT(*) FROM interaction_favorites WHERE target_type = 'content' AND target_id = ?) AS favorites,
       (SELECT COUNT(*) FROM social_share_links WHERE content_id = ?) AS shares,
       (SELECT COUNT(*) FROM social_reposts WHERE content_id = ?) AS reposts,
       EXISTS (
         SELECT 1 FROM social_profile_pins p
         WHERE p.content_id = ? AND p.user_id = ?
       ) AS pinned`,
  ).bind(contentId, contentId, contentId, contentId, contentId, contentId, pinnedOwnerUserId).first<{
    likes: number; comments: number; favorites: number; shares: number; reposts: number; pinned: number
  }>()

  const social = await getSocialTargets(db, 'content', contentId)
  let viewer: { liked: boolean; favorited: boolean; reposted: boolean } | null = null
  if (viewerUserIdValue) {
    const viewerUserId = id(viewerUserIdValue, 'UNAUTHENTICATED')
    const state = await db.prepare(
      `SELECT
         EXISTS (SELECT 1 FROM interaction_likes WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS liked,
         EXISTS (SELECT 1 FROM interaction_favorites WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS favorited,
         EXISTS (SELECT 1 FROM social_reposts WHERE actor_user_id = ? AND content_id = ?) AS reposted`,
    ).bind(viewerUserId, contentId, viewerUserId, contentId, viewerUserId, contentId).first<{
      liked: number; favorited: number; reposted: number
    }>()
    viewer = {
      liked: Boolean(state?.liked),
      favorited: Boolean(state?.favorited),
      reposted: Boolean(state?.reposted),
    }
  }

  return {
    contentId,
    contentType: contentContext.contentType,
    counts: {
      likes: Number(counts?.likes ?? 0),
      comments: Number(counts?.comments ?? 0),
      favorites: Number(counts?.favorites ?? 0),
      shares: Number(counts?.shares ?? 0),
      reposts: Number(counts?.reposts ?? 0),
    },
    pinned: Number(counts?.pinned ?? 0) === 1,
    viewer,
    topics: social.topics,
    mentions: social.mentions,
  }
}
