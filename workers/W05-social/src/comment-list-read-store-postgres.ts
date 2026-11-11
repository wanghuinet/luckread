import {
  buildCommentListReadQuery,
  CommentListReadStoreError,
  type CommentListReadInput,
  type CommentListReadRow,
  type CommentListReadStore,
} from './comment-list-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/** Structural node-postgres subset; the W05 Worker bundle does not include a database driver. */
export interface CommentListReadPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
}

export function createPostgresCommentListReadStore(
  db: CommentListReadPostgresQueryExecutor,
): CommentListReadStore {
  return {
    async list(input: CommentListReadInput): Promise<CommentListReadRow[]> {
      const { sql, values } = buildCommentListReadQuery(input, 'postgres')
      try {
        const result = await db.query<CommentListReadRow>(sql, values)
        return result.rows
      } catch {
        throw new CommentListReadStoreError()
      }
    },
  }
}
