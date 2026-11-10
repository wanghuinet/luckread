export const W10_EXECUTION_JOB_STATES = [
  'ACCEPTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCEL_REQUESTED',
  'STOPPING',
  'CANCELLED',
  'EXPIRED',
  'PARTIALLY_COMPLETED',
  'REQUIRES_ACTION',
  'UNKNOWN',
] as const

export type W10ExecutionJobState = (typeof W10_EXECUTION_JOB_STATES)[number]
export type W10ExecutionWorkerId =
  | 'W01' | 'W02' | 'W03' | 'W04' | 'W05' | 'W06'
  | 'W07' | 'W08' | 'W09' | 'W10' | 'W11' | 'W12'

export type W10ExecutionJobReadCursor = Readonly<{
  updatedAt: string
  operationId: string
}> | null

/** Safe operational projection; actor/subject IDs and raw payloads are excluded. */
export type W10ExecutionJobReadRow = Readonly<{
  job_id: string
  operation_id: string
  operation_type: string
  owner_worker: W10ExecutionWorkerId
  owner_task_id: string | null
  resource_type: string
  resource_id: string
  scope: string
  state: W10ExecutionJobState
  progress_current: number | string | null
  progress_total: number | string | null
  created_at: string
  started_at: string | null
  updated_at: string
  completed_at: string | null
  expires_at: string
  error_code: string | null
  result_ref: string | null
}>

export type W10ExecutionJobReadInput = Readonly<{
  ownerWorker: W10ExecutionWorkerId
  /** Omitted means all tasks for the owner; null explicitly selects ownerless jobs. */
  ownerTaskId?: string | null
  states?: readonly W10ExecutionJobState[]
  cursor?: W10ExecutionJobReadCursor
  /** Requested row count, including a page-size-plus-one sentinel when needed. */
  limit: number
}>

export interface W10ExecutionJobReadStore {
  getByOperationId(operationId: string): Promise<W10ExecutionJobReadRow | null>
  list(input: W10ExecutionJobReadInput): Promise<readonly W10ExecutionJobReadRow[]>
}

export interface W10D1Statement {
  bind(...values: unknown[]): {
    first<T>(): Promise<T | null>
    all<T>(): Promise<{ results?: T[] | null }>
  }
}

export interface W10D1ReadExecutor {
  prepare(sql: string): W10D1Statement
}

export class W10ExecutionJobReadStoreError extends Error {
  readonly code = 'SERVICE_UNAVAILABLE'
  readonly status = 503

  constructor() {
    super('W10_EXECUTION_JOB_READ_UNAVAILABLE')
    this.name = 'W10ExecutionJobReadStoreError'
  }
}

function assertValidRead(input: W10ExecutionJobReadInput): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 51) {
    throw new TypeError('W10_EXECUTION_JOB_READ_LIMIT_INVALID')
  }
  if (input.states && input.states.length === 0) return
  if (input.cursor && (
    !input.cursor.updatedAt ||
    !input.cursor.operationId
  )) {
    throw new TypeError('W10_EXECUTION_JOB_READ_CURSOR_INVALID')
  }
}

const SELECT_JOB_COLUMNS = `
  j.job_id,j.operation_id,j.operation_type,j.owner_worker,j.owner_task_id,
  j.resource_type,j.resource_id,j.scope,j.state,j.progress_current,j.progress_total,
  j.created_at,j.started_at,j.updated_at,j.completed_at,j.expires_at,
  j.error_code,j.result_ref
`

/** D1 remains the current production-default adapter. */
export function createD1W10ExecutionJobReadStore(
  db: W10D1ReadExecutor,
): W10ExecutionJobReadStore {
  return {
    async getByOperationId(operationId) {
      try {
        return await db.prepare(
          `SELECT ${SELECT_JOB_COLUMNS}
             FROM jobs j
            WHERE j.operation_id = ?`,
        ).bind(operationId).first<W10ExecutionJobReadRow>()
      } catch {
        throw new W10ExecutionJobReadStoreError()
      }
    },

    async list(input) {
      assertValidRead(input)
      if (input.states?.length === 0) return []

      const values: unknown[] = [input.ownerWorker]
      const predicates = ['j.owner_worker = ?']

      if (input.ownerTaskId !== undefined) {
        if (input.ownerTaskId === null) {
          predicates.push('j.owner_task_id IS NULL')
        } else {
          predicates.push('j.owner_task_id = ?')
          values.push(input.ownerTaskId)
        }
      }

      if (input.states) {
        predicates.push('j.state IN (' + input.states.map(() => '?').join(',') + ')')
        values.push(...input.states)
      }

      if (input.cursor) {
        predicates.push(
          '(j.updated_at < ? OR (j.updated_at = ? AND j.operation_id < ?))',
        )
        values.push(
          input.cursor.updatedAt,
          input.cursor.updatedAt,
          input.cursor.operationId,
        )
      }

      values.push(input.limit)
      try {
        const result = await db.prepare(
          `SELECT ${SELECT_JOB_COLUMNS}
             FROM jobs j
            WHERE ${predicates.join(' AND ')}
            ORDER BY j.updated_at DESC,j.operation_id DESC
            LIMIT ?`,
        ).bind(...values).all<W10ExecutionJobReadRow>()
        return result.results ?? []
      } catch {
        throw new W10ExecutionJobReadStoreError()
      }
    },
  }
}
