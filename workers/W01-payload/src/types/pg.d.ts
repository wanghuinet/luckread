declare module 'pg' {
  export interface QueryResultRow {
    [column: string]: any
  }

  export interface QueryResult<R extends QueryResultRow = QueryResultRow> {
    rows: R[]
    rowCount: number | null
  }

  export interface PoolClient {
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>>
    release(): void
  }

  export interface PoolOptions {
    connectionString: string
    max?: number
    connectionTimeoutMillis?: number
    idleTimeoutMillis?: number
    keepAlive?: boolean
  }

  export class Pool {
    constructor(options: PoolOptions)
    on(event: 'error', listener: (error: Error) => void): this
    connect(): Promise<PoolClient>
    query<R extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<R>>
    end(): Promise<void>
  }
}
