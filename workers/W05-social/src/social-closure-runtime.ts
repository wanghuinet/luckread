/// <reference types="@cloudflare/workers-types" />

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
const tokenPattern = /(^|[\\s([{"'“‘，。！？；：、])([@#])([\\p{L}\\p{N}_]{1,64})/gu

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
    .replace(/\\+/g, '-')
    .replace(/\\//g, '_')
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
): Promise<void> => {
  if (targetValue.targetType === 'content') {
    const row = await db.prepare(
      'SELECT owner_user_id, state FROM contents WHERE id = ? LIMIT 1',
    ).bind(targetValue.targetId).first<{ owner_user_id: string | null; state: string }>()
    if (!row || row.state !== 'PUBLISHED') throw new SocialClosureRuntimeError('NOT_FOUND', 404)
    if (row.owner_user_id !== actorUserId) throw new SocialClosureRuntimeError('PERMISSION_DENIED', 403)
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
): Promise<{ topics: number; mentions: number }> {
  const actorUserId = id(actorUserIdValue, 'UNAUTHENTICATED')
  const targetValue = target(targetTypeValue, targetIdValue)
  const text = textValue.normalize('NFKC').trim()
  if (text.length > MAX_TEXT) throw new SocialClosureRuntimeError('VALIDATION_FAILED', 400)

  await assertTargetPublished(db, targetValue, actorUserId)
  const tokens = extractSocialTokens(text)
  const now = new Date().toISOString()

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
    resolved.set(handle.toLocaleLowerCase(), { userId: id(entry.userId), handle })
  }

  let mentionCount = 0
  for (const token of tokens.filter((item) => item.kind === 'mention')) {
    const entry = resolved.get(token.normalized)
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
      payload: { handle: entry.handle },
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
  topicNameValue: string,
  limitValue: string | null,
  cursorValue: string | null = null,
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
  const limit = parseLimit(limitValue)
  const cursor = cursorValue
    ? decodeCursor(cursorValue)
    : null
  const topic = await db.prepare(
    'SELECT topic_id, normalized_name, display_name, status FROM social_topics WHERE normalized_name = ? LIMIT 1',
  ).bind(normalizedName).first<{ topic_id: string; normalized_name: string; display_name: string; status: string }>()
  if (!topic || topic.status !== 'ACTIVE') throw new SocialClosureRuntimeError('NOT_FOUND', 404)

  const where = cursor
    ? ' AND (c.updated_at < ? OR (c.updated_at = ? AND c.id < ?))'
    : ''
  const binds = cursor
    ? [topic.topic_id, cursor.createdAt, cursor.createdAt, cursor.notificationId, limit + 1]
    : [topic.topic_id, limit + 1]

  const rows = await db.prepare(
    `SELECT c.id, c.content_type, c.title, c.updated_at
       FROM social_target_topics st
       JOIN contents c ON c.id = st.target_id
      WHERE st.target_type = 'content'
        AND st.topic_id = ?
        AND c.state = 'PUBLISHED'${where}
      ORDER BY c.updated_at DESC, c.id DESC
      LIMIT ?`,
  ).bind(...binds).all<{ id: string; content_type: string; title: string; updated_at: string }>()

  const items = rows.results ?? []
  const visible = items.slice(0, limit)
  const last = visible.at(-1)
  return {
    topic: {
      topicId: topic.topic_id,
      name: topic.normalized_name,
      displayName: topic.display_name,
      status: topic.status,
    },
    contents: visible.map((row) => ({
      id: row.id,
      contentType: row.content_type,
      title: row.title,
      updatedAt: row.updated_at,
    })),
    hasMore: items.length > limit,
    nextCursor: items.length > limit && last ? encodeCursor(last.updated_at, last.id) : null,
  }
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
  const recipientUserId = id(input.recipientUserId)
  const actorUserId = id(input.actorUserId, 'UNAUTHENTICATED')
  const targetId = id(input.targetId)
  if (recipientUserId === actorUserId) return

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

  const dedupeKey = [input.type, recipientUserId, actorUserId, input.targetType, targetId].join(':')
  const now = new Date().toISOString()
  await db.prepare(
    `INSERT OR IGNORE INTO social_notifications
      (notification_id, recipient_user_id, actor_user_id, notification_type, target_type, target_id, dedupe_key, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    recipientUserId,
    actorUserId,
    input.type,
    input.targetType,
    targetId,
    dedupeKey,
    JSON.stringify(input.payload ?? {}),
    now,
  ).run()
}

export async function drainNotificationOutbox(db: D1Database, limitValue = 50): Promise<number> {
  const limit = Math.max(1, Math.min(limitValue, 100))
  const rows = await db.prepare(
    `SELECT event_id, recipient_user_id, actor_user_id, notification_type, target_type, target_id, dedupe_key, payload_json
       FROM social_notification_outbox
      WHERE dispatched_at IS NULL
      ORDER BY created_at ASC, event_id ASC
      LIMIT ?`,
  ).bind(limit).all<{
    event_id: string
    recipient_user_id: string
    actor_user_id: string
    notification_type: SocialNotificationType
    target_type: 'user' | 'content' | 'comment'
    target_id: string
    dedupe_key: string
    payload_json: string
  }>()

  let dispatched = 0
  for (const row of rows.results ?? []) {
    const result = await db.prepare(
      `INSERT OR IGNORE INTO social_notifications
        (notification_id, recipient_user_id, actor_user_id, notification_type, target_type, target_id, dedupe_key, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    ).bind(
      crypto.randomUUID(),
      row.recipient_user_id,
      row.actor_user_id,
      row.notification_type,
      row.target_type,
      row.target_id,
      row.dedupe_key,
      row.payload_json,
    ).run()
    if (result.success) {
      await db.prepare(
        'UPDATE social_notification_outbox SET dispatched_at = CURRENT_TIMESTAMP WHERE event_id = ? AND dispatched_at IS NULL',
      ).bind(row.event_id).run()
      dispatched += 1
    }
  }
  return dispatched
}

export async function listNotifications(
  db: D1Database,
  recipientUserIdValue: string,
  cursorValue: string | null,
  limitValue: string | null,
) {
  const recipientUserId = id(recipientUserIdValue, 'UNAUTHENTICATED')
  const limit = parseLimit(limitValue)
  const cursor = decodeCursor(cursorValue)
  const whereCursor = cursor ? ' AND (created_at < ? OR (created_at = ? AND notification_id < ?))' : ''
  const binds = cursor
    ? [recipientUserId, cursor.createdAt, cursor.createdAt, cursor.notificationId, limit + 1]
    : [recipientUserId, limit + 1]

  const rows = await db.prepare(
    `SELECT notification_id, notification_type, actor_user_id, target_type, target_id, payload_json, read_at, created_at
       FROM social_notifications
      WHERE recipient_user_id = ?${whereCursor}
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
  viewerUserIdValue?: string | null,
) {
  const contentId = id(contentIdValue)
  const content = await db.prepare(
    'SELECT id, content_type, state FROM contents WHERE id = ? LIMIT 1',
  ).bind(contentId).first<{ id: string; content_type: string; state: string }>()
  if (!content || content.state !== 'PUBLISHED') throw new SocialClosureRuntimeError('NOT_FOUND', 404)

  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM interaction_likes WHERE target_type = 'content' AND target_id = ?) AS likes,
       (SELECT COUNT(*) FROM social_comments WHERE content_id = ? AND state = 'PUBLISHED') AS comments,
       (SELECT COUNT(*) FROM interaction_favorites WHERE target_type = 'content' AND target_id = ?) AS favorites,
       (SELECT COUNT(*) FROM social_share_links WHERE content_id = ?) AS shares`,
  ).bind(contentId, contentId, contentId, contentId).first<{ likes: number; comments: number; favorites: number; shares: number }>()

  const social = await getSocialTargets(db, 'content', contentId)
  let viewer: { liked: boolean; favorited: boolean } | null = null
  if (viewerUserIdValue) {
    const viewerUserId = id(viewerUserIdValue, 'UNAUTHENTICATED')
    const state = await db.prepare(
      `SELECT
         EXISTS (SELECT 1 FROM interaction_likes WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS liked,
         EXISTS (SELECT 1 FROM interaction_favorites WHERE actor_user_id = ? AND target_type = 'content' AND target_id = ?) AS favorited`,
    ).bind(viewerUserId, contentId, viewerUserId, contentId).first<{ liked: number; favorited: number }>()
    viewer = { liked: Boolean(state?.liked), favorited: Boolean(state?.favorited) }
  }

  return {
    contentId,
    contentType: content.content_type,
    counts: {
      likes: Number(counts?.likes ?? 0),
      comments: Number(counts?.comments ?? 0),
      favorites: Number(counts?.favorites ?? 0),
      shares: Number(counts?.shares ?? 0),
    },
    viewer,
    topics: social.topics,
    mentions: social.mentions,
  }
}
