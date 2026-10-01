export type FollowListDirection = 'followers' | 'following'

export type FollowListCursor = {
  createdAt: string
  relationshipId: string
}

export type FollowListQuery = {
  sql: string
  binds: unknown[]
  responseLimit: number
  readLimit: number
}

export class FollowReadAdmissionError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const MAX_ID = 128
const MAX_PAGE_SIZE = 50
const MAX_CURSOR_LENGTH = 1024
const validId = (value: string): boolean => value.length > 0 && value.length <= MAX_ID

function encodeCursor(cursor: FollowListCursor): string {
  return btoa(JSON.stringify(cursor))
}

export function decodeFollowListCursor(value: string): FollowListCursor {
  if (!value || value.length > MAX_CURSOR_LENGTH) {
    throw new FollowReadAdmissionError('INVALID_CURSOR')
  }

  try {
    const parsed = JSON.parse(atob(value)) as Partial<FollowListCursor>
    if (
      typeof parsed.createdAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.createdAt)) ||
      typeof parsed.relationshipId !== 'string' ||
      !validId(parsed.relationshipId)
    ) {
      throw new FollowReadAdmissionError('INVALID_CURSOR')
    }
    return {
      createdAt: new Date(parsed.createdAt).toISOString(),
      relationshipId: parsed.relationshipId,
    }
  } catch (error) {
    if (error instanceof FollowReadAdmissionError) throw error
    throw new FollowReadAdmissionError('INVALID_CURSOR')
  }
}

export function encodeFollowListCursor(cursor: FollowListCursor): string {
  if (
    !Number.isNaN(Date.parse(cursor.createdAt)) &&
    validId(cursor.relationshipId)
  ) {
    return encodeCursor({
      createdAt: new Date(cursor.createdAt).toISOString(),
      relationshipId: cursor.relationshipId,
    })
  }
  throw new FollowReadAdmissionError('INVALID_CURSOR')
}

export function buildFollowListQuery(input: {
  direction: FollowListDirection
  subjectUserId: string
  cursor?: string | null
  limit?: number | null
}): FollowListQuery {
  if (!validId(input.subjectUserId)) {
    throw new FollowReadAdmissionError('INVALID_SUBJECT')
  }

  const responseLimit = input.limit ?? MAX_PAGE_SIZE
  if (!Number.isSafeInteger(responseLimit) || responseLimit < 1 || responseLimit > MAX_PAGE_SIZE) {
    throw new FollowReadAdmissionError('INVALID_LIMIT')
  }

  const column = input.direction === 'followers' ? 'target_user_id' : 'follower_user_id'
  const binds: unknown[] = [input.subjectUserId]
  let sql = `
    SELECT
      relationship_id AS relationshipId,
      follower_user_id AS followerUserId,
      target_user_id AS targetUserId,
      created_at AS createdAt
    FROM social_follow_relationships
    WHERE ${column} = ?
  `

  if (input.cursor) {
    const cursor = decodeFollowListCursor(input.cursor)
    sql += `
      AND (
        created_at < ?
        OR (created_at = ? AND relationship_id < ?)
      )
    `
    binds.push(cursor.createdAt, cursor.createdAt, cursor.relationshipId)
  }

  sql += ' ORDER BY created_at DESC, relationship_id DESC LIMIT ?'
  const readLimit = responseLimit + 1
  binds.push(readLimit)

  return {
    sql: sql.replace(/\s+/g, ' ').trim(),
    binds,
    responseLimit,
    readLimit,
  }
}

export function toFollowListItem(row: {
  relationshipId: string
  followerUserId: string
  targetUserId: string
  createdAt: string
}, direction: FollowListDirection) {
  return {
    userId: direction === 'followers' ? row.followerUserId : row.targetUserId,
    createdAt: row.createdAt,
  }
}

export const FOLLOW_LIST_LIMITS = {
  responseItemsMax: MAX_PAGE_SIZE,
  readRowsMax: MAX_PAGE_SIZE + 1,
  cursorMaxLength: MAX_CURSOR_LENGTH,
} as const
