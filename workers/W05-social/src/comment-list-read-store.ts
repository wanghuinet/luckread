export type CommentListSort = 'relevant' | 'recent' | 'liked'

export type CommentListCursor = {
  createdAt: string
  id: string
  threadCreatedAt?: string
  threadId?: string
  threadLikeCount?: number
}

export type CommentListReadInput = {
  contentId: string
  viewerUserId: string | null
  cursor: CommentListCursor | null
  limit: number
  sort: CommentListSort
}

export type CommentListReadRow = {
  id: string
  content_id: string
  author_user_id: string
  parent_id: string | null
  body: string
  state: 'PENDING' | 'PUBLISHED' | 'REJECTED'
  depth: number
  created_at: string
  updated_at: string
  mentions_json: string
  liked_by_viewer: number | boolean
  thread_created_at: string
  thread_id: string
  thread_like_count: number | string
}

export interface CommentListReadStore {
  list(input: CommentListReadInput): Promise<CommentListReadRow[]>
}

export class CommentListReadStoreError extends Error {
  constructor() { super('COMMENT_LIST_READ_STORE_UNAVAILABLE') }
}

type CommentListReadDialect = 'd1' | 'postgres'

export function buildCommentListReadQuery(
  input: CommentListReadInput,
  dialect: CommentListReadDialect,
): { sql: string; values: unknown[] } {
  const values: unknown[] = []
  const parameter = (value: unknown): string => {
    values.push(value)
    return dialect === 'postgres' ? `$${values.length}` : '?'
  }
  const timestampParameter = (value: string): string => {
    const placeholder = parameter(value)
    return dialect === 'postgres' ? `${placeholder}::timestamptz` : placeholder
  }

  const viewerParameter = parameter(input.viewerUserId)
  const contentParameter = parameter(input.contentId)
  const visibilitySql = input.viewerUserId
    ? `AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ${parameter(input.viewerUserId)} AND block.target_user_id = c.author_user_id)
              OR
              (block.actor_user_id = c.author_user_id AND block.target_user_id = ${parameter(input.viewerUserId)})
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions mute
          WHERE mute.relation_type = 'mute'
            AND mute.actor_user_id = ${parameter(input.viewerUserId)}
            AND mute.target_user_id = c.author_user_id
       )`
    : ''
  const childVisibilitySql = input.viewerUserId
    ? `AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions block
          WHERE block.relation_type = 'block'
            AND (
              (block.actor_user_id = ${parameter(input.viewerUserId)} AND block.target_user_id = child.author_user_id)
              OR
              (block.actor_user_id = child.author_user_id AND block.target_user_id = ${parameter(input.viewerUserId)})
            )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM social_user_interactions mute
          WHERE mute.relation_type = 'mute'
            AND mute.actor_user_id = ${parameter(input.viewerUserId)}
            AND mute.target_user_id = child.author_user_id
       )`
    : ''

  const rankedContentParameter = parameter(input.contentId)
  const cursor = input.cursor
  let whereCursor = ''
  if (cursor && input.sort === 'liked') {
    const count = cursor.threadLikeCount ?? 0
    const threadCreatedAt = cursor.threadCreatedAt ?? cursor.createdAt
    const threadId = cursor.threadId ?? cursor.id
    whereCursor = `AND (
      c.thread_like_count < ${parameter(count)}
      OR (c.thread_like_count = ${parameter(count)} AND (
        c.thread_created_at < ${timestampParameter(threadCreatedAt)}
        OR (c.thread_created_at = ${timestampParameter(threadCreatedAt)} AND c.thread_id < ${parameter(threadId)})
      ))
      OR (c.thread_like_count = ${parameter(count)}
        AND c.thread_created_at = ${timestampParameter(threadCreatedAt)}
        AND c.thread_id = ${parameter(threadId)}
        AND (c.created_at > ${timestampParameter(cursor.createdAt)}
          OR (c.created_at = ${timestampParameter(cursor.createdAt)} AND c.id > ${parameter(cursor.id)})))
    )`
  } else if (cursor && input.sort === 'recent') {
    const threadCreatedAt = cursor.threadCreatedAt ?? cursor.createdAt
    const threadId = cursor.threadId ?? cursor.id
    whereCursor = `AND (
      (c.thread_created_at < ${timestampParameter(threadCreatedAt)}
        OR (c.thread_created_at = ${timestampParameter(threadCreatedAt)} AND c.thread_id < ${parameter(threadId)}))
      OR (c.thread_created_at = ${timestampParameter(threadCreatedAt)}
        AND c.thread_id = ${parameter(threadId)}
        AND (c.created_at > ${timestampParameter(cursor.createdAt)}
          OR (c.created_at = ${timestampParameter(cursor.createdAt)} AND c.id > ${parameter(cursor.id)})))
    )`
  } else if (cursor) {
    whereCursor = `AND (c.created_at > ${timestampParameter(cursor.createdAt)}
      OR (c.created_at = ${timestampParameter(cursor.createdAt)} AND c.id > ${parameter(cursor.id)}))`
  }

  const orderBy = input.sort === 'liked'
    ? 'c.thread_like_count DESC, c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC'
    : input.sort === 'recent'
      ? 'c.thread_created_at DESC, c.thread_id DESC, c.created_at ASC, c.id ASC'
      : 'c.created_at ASC, c.id ASC'
  const threadLikeCountSql = input.sort === 'liked'
    ? `(SELECT COUNT(*) FROM interaction_likes thread_likes WHERE thread_likes.target_type = 'comment' AND thread_likes.target_id = c.thread_id) AS thread_like_count`
    : '0 AS thread_like_count'
  const mentionsSql = dialect === 'postgres'
    ? `COALESCE((
         SELECT json_agg(json_build_object(
           'userId', mention.mentioned_user_id,
           'handle', mention.handle
         ) ORDER BY mention.created_at ASC)
         FROM (
           SELECT mentioned_user_id, handle, created_at
             FROM social_mentions
            WHERE target_type = 'comment'
              AND target_id = c.id
            ORDER BY created_at ASC
            LIMIT 100
         ) mention
       ), '[]'::json)::text AS mentions_json`
    : `COALESCE((
         SELECT json_group_array(json_object(
           'userId', mention.mentioned_user_id,
           'handle', mention.handle
         ))
         FROM (
           SELECT mentioned_user_id, handle
             FROM social_mentions
            WHERE target_type = 'comment'
              AND target_id = c.id
            ORDER BY created_at ASC
            LIMIT 100
         ) mention
       ), '[]') AS mentions_json`
  const createdAtSql = dialect === 'postgres'
    ? 'to_char(c.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')'
    : 'c.created_at'
  const updatedAtSql = dialect === 'postgres'
    ? 'to_char(c.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')'
    : 'c.updated_at'
  const threadCreatedAtSql = dialect === 'postgres'
    ? 'to_char(c.thread_created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\')'
    : 'c.thread_created_at'
  const limitParameter = parameter(input.limit + 1)

  const viewerSelect = dialect === 'postgres' ? `${viewerParameter}::text` : viewerParameter
  const sql = `WITH RECURSIVE viewer AS (SELECT ${viewerSelect} AS user_id), public_comments AS (
       SELECT
         c.id,
         c.content_id,
         c.author_user_id,
         c.parent_id,
         c.body,
         c.state,
         c.depth,
         c.created_at,
         c.updated_at,
         c.created_at AS thread_created_at,
         c.id AS thread_id
       FROM social_comments c
       WHERE c.content_id = ${contentParameter}
         AND c.state = 'PUBLISHED'
         AND c.parent_id IS NULL
         ${visibilitySql}

       UNION ALL

       SELECT
         child.id,
         child.content_id,
         child.author_user_id,
         child.parent_id,
         child.body,
         child.state,
         child.depth,
         child.created_at,
         child.updated_at,
         parent.thread_created_at,
         parent.thread_id
       FROM social_comments child
       JOIN public_comments parent ON parent.id = child.parent_id
       WHERE child.state = 'PUBLISHED'
         AND parent.depth < 3
         ${childVisibilitySql}
     ), ranked_comments AS (
       SELECT
         c.*,
         ${threadLikeCountSql},
         EXISTS (
           SELECT 1
             FROM interaction_likes liked
             JOIN viewer v ON v.user_id = liked.actor_user_id
            WHERE liked.target_type = 'comment'
              AND liked.target_id = c.id
         ) AS liked_by_viewer
       FROM public_comments c
       WHERE c.content_id = ${rankedContentParameter}
     )
     SELECT
       c.id,
       c.content_id,
       c.author_user_id,
       c.parent_id,
       c.body,
       c.state,
       c.depth,
       ${createdAtSql} AS created_at,
       ${updatedAtSql} AS updated_at,
       ${mentionsSql},
       c.liked_by_viewer,
       ${threadCreatedAtSql} AS thread_created_at,
       c.thread_id,
       c.thread_like_count
     FROM ranked_comments c
     WHERE 1 = 1
       ${whereCursor}
     ORDER BY ${orderBy}
     LIMIT ${limitParameter}`

  return { sql, values }
}

export interface CommentListReadD1Executor {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<Row>(): Promise<{ results?: Row[] }>
    }
  }
}

export function createD1CommentListReadStore(db: CommentListReadD1Executor): CommentListReadStore {
  return {
    async list(input) {
      const { sql, values } = buildCommentListReadQuery(input, 'd1')
      try {
        const result = await db.prepare(sql).bind(...values).all<CommentListReadRow>()
        return result.results ?? []
      } catch {
        throw new CommentListReadStoreError()
      }
    },
  }
}
