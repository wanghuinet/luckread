import {
  ContentLikerReadStoreError,
  type ContentLikerReadInput,
  type ContentLikerReadRow,
  type ContentLikerReadStore,
} from './like-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; no database driver is bundled into W05 Worker code. */
export interface ContentLikerPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

/**
 * PostgreSQL counterpart for W05's bounded content-liker page.
 * Six-digit UTC timestamps keep keyset cursors stable across PostgreSQL round trips.
 */
export function createPostgresContentLikerReadStore(
  db: ContentLikerPostgresQueryExecutor,
): ContentLikerReadStore {
  return {
    async list(input: ContentLikerReadInput) {
      const values: unknown[] = [
        input.contentId,
        input.contentOwnerUserId,
        input.contentOwnerUserId,
      ]
      let visibility = `
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions content_block
           WHERE content_block.relation_type = 'block'
             AND (
               (content_block.actor_user_id = il.actor_user_id AND content_block.target_user_id = $2)
               OR (content_block.actor_user_id = $3 AND content_block.target_user_id = il.actor_user_id)
             )
        )`

      if (input.viewerUserId) {
        const viewerBlockStart = values.length + 1
        const likerBlockStart = viewerBlockStart + 4
        visibility += `
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions viewer_block
           WHERE viewer_block.relation_type = 'block'
             AND (
               (viewer_block.actor_user_id = $${viewerBlockStart} AND viewer_block.target_user_id = $${viewerBlockStart + 1})
               OR (viewer_block.actor_user_id = $${viewerBlockStart + 2} AND viewer_block.target_user_id = $${viewerBlockStart + 3})
             )
        )
        AND NOT EXISTS (
          SELECT 1
            FROM social_user_interactions liker_block
           WHERE liker_block.relation_type = 'block'
             AND (
               (liker_block.actor_user_id = $${likerBlockStart} AND liker_block.target_user_id = il.actor_user_id)
               OR (liker_block.actor_user_id = il.actor_user_id AND liker_block.target_user_id = $${likerBlockStart + 1})
             )
        )`
        values.push(
          input.viewerUserId,
          input.contentOwnerUserId,
          input.contentOwnerUserId,
          input.viewerUserId,
          input.viewerUserId,
          input.viewerUserId,
        )
      }

      let cursorSql = ''
      if (input.cursor) {
        const timestampParameter = values.length + 1
        const relationshipParameter = timestampParameter + 1
        cursorSql =
          ' AND (il.created_at < 
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' OR (il.created_at = 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' AND il.relationship_id < 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' OR (il.created_at = 
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' OR (il.created_at = 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' AND il.relationship_id < 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' AND il.relationship_id < 
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' OR (il.created_at = 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' AND il.relationship_id < 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' OR (il.created_at = 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + timestampParameter + '::timestamptz' +
          ' AND il.relationship_id < 
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
 + relationshipParameter + '))'
        values.push(input.cursor.createdAt, input.cursor.relationshipId)
      }

      values.push(input.limit)
      const limitParameter = values.length
      const sql = `
        SELECT
          il.relationship_id,
          il.actor_user_id,
          to_char(il.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
          FROM interaction_likes il
         WHERE il.target_type = 'content'
           AND il.target_id = $1
           ${visibility}
           ${cursorSql}
         ORDER BY il.created_at DESC, il.relationship_id DESC
         LIMIT $${limitParameter}
      `

      try {
        const result = await db.query<ContentLikerReadRow>(sql, values)
        return result.rows
      } catch {
        // Never expose driver messages, SQL text or connection metadata.
        throw new ContentLikerReadStoreError()
      }
    },
  }
}
