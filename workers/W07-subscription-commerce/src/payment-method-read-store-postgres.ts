import { strictlyAfterCanonicalUtcTimestamp } from './canonical-utc-timestamp.js'
import {
  PaymentMethodPersistenceError,
  type PaymentMethodRevocationRequest,
  type SavedPaymentMethodMandate,
  type SavedPaymentMethodRecord,
} from './payment-method-persistence.js'
import type { PaymentMethodReadStore } from './payment-method-read-store.js'

type QueryResult<Row> = Readonly<{ rows: Row[] }>

/**
 * Structural subset of node-postgres Pool/Client. Kept local so the Worker
 * bundle does not acquire a Node PostgreSQL runtime dependency.
 */
export interface PaymentMethodPostgresQueryExecutor {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect?: () => Promise<PaymentMethodPostgresTransactionClient>
}

export interface PaymentMethodPostgresTransactionClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

type SavedPaymentMethodRow = {
  saved_payment_method_id: string
  payment_method_id: string
  created_at: string
  mandate_status: SavedPaymentMethodRecord['mandateStatus']
  revocation_status: SavedPaymentMethodRecord['revocationStatus']
}

type MandateRow = {
  mandate_record_id: string
  provider_mandate_id: string | null
  payment_method_id: string
  status: SavedPaymentMethodMandate['status']
}

const PROVIDER = 'hyperswitch'
const SAVED_METHOD_ID = /^spm_[A-Za-z0-9]{26}$/

function validateOwner(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400)
  }
  return value
}

function mapQueryError(error: unknown): PaymentMethodPersistenceError {
  if (error instanceof PaymentMethodPersistenceError) return error
  if (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === '23505'
  ) {
    return new PaymentMethodPersistenceError('CONFLICT', 409)
  }
  return new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503)
}

/**
 * PostgreSQL 18 counterpart for the D1 read boundary. It preserves the exact
 * status precedence, merchant/customer scoping, ordering and 100-row bound.
 */

type RevocationRequestRow = {
  revocation_request_id: string
  saved_payment_method_id: string
  payment_method_id: string
  customer_id: string
  merchant_id: string
  idempotency_key: string
  status: PaymentMethodRevocationRequest['status']
  provider_method_deleted_at: Date | string | null
  version: number | string
  updated_at: Date | string
}

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{1,128}$/

function isoTimestamp(value: Date | string | null): string | null {
  if (value === null) return null
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return date.toISOString()
}

function toRevocationRequest(row: RevocationRequestRow): PaymentMethodRevocationRequest {
  return {
    revocationRequestId: row.revocation_request_id,
    savedPaymentMethodId: row.saved_payment_method_id,
    paymentMethodId: row.payment_method_id,
    customerId: row.customer_id,
    merchantId: row.merchant_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    providerMethodDeletedAt: isoTimestamp(row.provider_method_deleted_at),
    version: Number(row.version),
    updatedAt: isoTimestamp(row.updated_at)!,
  }
}

async function withPostgresTransaction<T>(
  db: PaymentMethodPostgresQueryExecutor,
  action: (client: PaymentMethodPostgresTransactionClient) => Promise<T>,
): Promise<T> {
  if (!db.connect) {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  const client = await db.connect()
  try {
    await client.query('BEGIN')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    if (error instanceof PaymentMethodPersistenceError) throw error
    throw mapQueryError(error)
  } finally {
    client.release()
  }
}

async function readRevocationRequest(
  db: PaymentMethodPostgresQueryExecutor | PaymentMethodPostgresTransactionClient,
  savedPaymentMethodId: string,
  customerId: string,
  merchantId: string,
  forUpdate = false,
): Promise<RevocationRequestRow | null> {
  const result = await db.query<RevocationRequestRow>(
    'SELECT revocation_request_id, saved_payment_method_id, payment_method_id, customer_id, merchant_id, ' +
    'idempotency_key, status, provider_method_deleted_at, version, updated_at ' +
    'FROM payment_method_revocation_requests WHERE saved_payment_method_id = $1 ' +
    'AND customer_id = $2 AND merchant_id = $3 LIMIT 1' +
    (forUpdate ? ' FOR UPDATE' : ''),
    [savedPaymentMethodId, customerId, merchantId],
  )
  return result.rows[0] ?? null
}

async function createRevocationRequest(
  db: PaymentMethodPostgresQueryExecutor,
  customerIdInput: string,
  merchantIdInput: string,
  savedPaymentMethodId: string,
  idempotencyKey: string,
  now: string,
  createId: () => string = () => 'pmr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 26),
) {
  const customerId = validateOwner(customerIdInput)
  const merchantId = validateOwner(merchantIdInput)
  if (!SAVED_METHOD_ID.test(savedPaymentMethodId) || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400)
  }
  const nowMs = Date.parse(now)
  if (!Number.isFinite(nowMs) || new Date(nowMs).toISOString() !== now) {
    throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400)
  }
  const revocationRequestId = createId()
  if (!/^pmr_[A-Za-z0-9]{26}$/.test(revocationRequestId)) {
    throw new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503)
  }

  return withPostgresTransaction(db, async (client) => {
    const existing = await readRevocationRequest(
      client, savedPaymentMethodId, customerId, merchantId, true,
    )
    if (existing) {
      if (existing.idempotency_key !== idempotencyKey) {
        throw new PaymentMethodPersistenceError('CONFLICT', 409)
      }
      return {
        request: toRevocationRequest(existing),
        replayed: true,
        dispatchProvider: true,
      }
    }

    const inserted = await client.query<RevocationRequestRow>(
      'INSERT INTO payment_method_revocation_requests ' +
      '(revocation_request_id, saved_payment_method_id, payment_method_id, provider, merchant_id, customer_id, ' +
      'idempotency_key, status, provider_method_deleted_at, version, created_at, updated_at) ' +
      "SELECT $1, s.saved_payment_method_id, s.payment_method_id, 'hyperswitch', s.merchant_id, s.customer_id, " +
      "$2, 'REQUESTED', NULL, 1, $3::timestamptz, $3::timestamptz " +
      'FROM saved_payment_methods s WHERE s.saved_payment_method_id = $4 AND s.provider = $5 ' +
      'AND s.merchant_id = $6 AND s.customer_id = $7 ' +
      'ON CONFLICT (saved_payment_method_id) DO NOTHING ' +
      'RETURNING revocation_request_id, saved_payment_method_id, payment_method_id, customer_id, merchant_id, ' +
      'idempotency_key, status, provider_method_deleted_at, version, updated_at',
      [revocationRequestId, idempotencyKey, now, savedPaymentMethodId, PROVIDER, merchantId, customerId],
    )
    const row = inserted.rows[0] ?? await readRevocationRequest(
      client, savedPaymentMethodId, customerId, merchantId, true,
    )
    if (!row) throw new PaymentMethodPersistenceError('RESOURCE_NOT_FOUND', 404)
    if (row.idempotency_key !== idempotencyKey) {
      throw new PaymentMethodPersistenceError('CONFLICT', 409)
    }
    return {
      request: toRevocationRequest(row),
      replayed: row.revocation_request_id !== revocationRequestId,
      // The first request only persists the MIT block. A replay performs
      // provider I/O, preserving the one-write-per-request API contract.
      dispatchProvider: inserted.rows.length === 0,
    }
  })
}

async function markProviderDeleted(
  db: PaymentMethodPostgresQueryExecutor,
  input: PaymentMethodRevocationRequest,
  now: string,
): Promise<PaymentMethodRevocationRequest> {
  if (input.status === 'COMPLETED') return input
  const updatedAt = strictlyAfterCanonicalUtcTimestamp(now, input.updatedAt)
  if (!updatedAt) throw new PaymentMethodPersistenceError('VALIDATION_FAILED', 400)

  return withPostgresTransaction(db, async (client) => {
    const currentResult = await client.query<RevocationRequestRow>(
      'SELECT revocation_request_id, saved_payment_method_id, payment_method_id, customer_id, merchant_id, ' +
      'idempotency_key, status, provider_method_deleted_at, version, updated_at ' +
      'FROM payment_method_revocation_requests WHERE revocation_request_id = $1 AND customer_id = $2 FOR UPDATE',
      [input.revocationRequestId, input.customerId],
    )
    const current = currentResult.rows[0]
    if (!current) throw new PaymentMethodPersistenceError('RESOURCE_NOT_FOUND', 404)
    if (current.status === 'COMPLETED') return toRevocationRequest(current)
    if (Number(current.version) !== input.version) {
      if (current.provider_method_deleted_at !== null) return toRevocationRequest(current)
      throw new PaymentMethodPersistenceError('CONFLICT', 409)
    }

    const updated = await client.query<RevocationRequestRow>(
      'UPDATE payment_method_revocation_requests r SET ' +
      'provider_method_deleted_at = COALESCE(r.provider_method_deleted_at, $1::timestamptz), ' +
      "status = CASE WHEN NOT EXISTS (SELECT 1 FROM payment_mandates m WHERE m.provider = r.provider " +
      'AND m.merchant_id = r.merchant_id AND m.customer_id = r.customer_id ' +
      "AND m.payment_method_id = r.payment_method_id AND m.status NOT IN ('REVOKED','FAILED','EXPIRED')) " +
      "THEN 'COMPLETED' ELSE 'PENDING_PROVIDER' END, " +
      'version = r.version + 1, updated_at = $2::timestamptz ' +
      'WHERE r.revocation_request_id = $3 AND r.customer_id = $4 AND r.version = $5 ' +
      'RETURNING r.revocation_request_id, r.saved_payment_method_id, r.payment_method_id, r.customer_id, ' +
      'r.merchant_id, r.idempotency_key, r.status, r.provider_method_deleted_at, r.version, r.updated_at',
      [now, updatedAt, input.revocationRequestId, input.customerId, input.version],
    )
    const row = updated.rows[0]
    if (!row) throw new PaymentMethodPersistenceError('CONFLICT', 409)
    return toRevocationRequest(row)
  })
}

export function createPostgresPaymentMethodReadStore(
  db: PaymentMethodPostgresQueryExecutor,
): PaymentMethodReadStore {
  return {
    async listSavedPaymentMethodRecords(customerIdInput, merchantIdInput) {
      const customerId = validateOwner(customerIdInput)
      const merchantId = validateOwner(merchantIdInput)

      try {
        const result = await db.query<SavedPaymentMethodRow>(
          `SELECT
             s.saved_payment_method_id,
             s.payment_method_id,
             to_char(
               s.created_at AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
             ) AS created_at,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM payment_mandates m
                  WHERE m.provider = s.provider
                    AND m.merchant_id = s.merchant_id
                    AND m.customer_id = s.customer_id
                    AND m.payment_method_id = s.payment_method_id
                    AND m.status = 'ACTIVE'
               ) THEN 'ACTIVE'
               WHEN EXISTS (
                 SELECT 1 FROM payment_mandates m
                  WHERE m.provider = s.provider
                    AND m.merchant_id = s.merchant_id
                    AND m.customer_id = s.customer_id
                    AND m.payment_method_id = s.payment_method_id
                    AND m.status = 'PENDING_PROVIDER_CONFIRMATION'
               ) THEN 'PENDING_PROVIDER_CONFIRMATION'
               WHEN EXISTS (
                 SELECT 1 FROM payment_mandates m
                  WHERE m.provider = s.provider
                    AND m.merchant_id = s.merchant_id
                    AND m.customer_id = s.customer_id
                    AND m.payment_method_id = s.payment_method_id
                    AND m.status = 'REVOKED'
               ) THEN 'REVOKED'
               WHEN EXISTS (
                 SELECT 1 FROM payment_mandates m
                  WHERE m.provider = s.provider
                    AND m.merchant_id = s.merchant_id
                    AND m.customer_id = s.customer_id
                    AND m.payment_method_id = s.payment_method_id
                    AND m.status = 'EXPIRED'
               ) THEN 'EXPIRED'
               WHEN EXISTS (
                 SELECT 1 FROM payment_mandates m
                  WHERE m.provider = s.provider
                    AND m.merchant_id = s.merchant_id
                    AND m.customer_id = s.customer_id
                    AND m.payment_method_id = s.payment_method_id
                    AND m.status = 'FAILED'
               ) THEN 'FAILED'
               ELSE 'NONE'
             END AS mandate_status,
             r.status AS revocation_status
           FROM saved_payment_methods s
           LEFT JOIN payment_method_revocation_requests r
             ON r.saved_payment_method_id = s.saved_payment_method_id
           WHERE s.provider = $1
             AND s.merchant_id = $2
             AND s.customer_id = $3
             AND (r.revocation_request_id IS NULL OR r.status <> 'COMPLETED')
           ORDER BY s.created_at DESC, s.saved_payment_method_id DESC
           LIMIT 100`,
          [PROVIDER, merchantId, customerId],
        )
        return result.rows.map((row) => ({
          savedPaymentMethodId: row.saved_payment_method_id,
          paymentMethodId: row.payment_method_id,
          createdAt: row.created_at,
          mandateStatus: row.mandate_status,
          revocationStatus: row.revocation_status,
        }))
      } catch (error) {
        throw mapQueryError(error)
      }
    },

    createPaymentMethodRevocationRequest(customerId, merchantId, savedPaymentMethodId, idempotencyKey, now, createId) {
      return createRevocationRequest(db, customerId, merchantId, savedPaymentMethodId, idempotencyKey, now, createId)
    },

    markPaymentMethodProviderDeleted(input, now) {
      return markProviderDeleted(db, input, now)
    },

    async getSavedPaymentMethodMandates(customerIdInput, merchantIdInput, savedPaymentMethodId) {
      const customerId = validateOwner(customerIdInput)
      const merchantId = validateOwner(merchantIdInput)
      if (!SAVED_METHOD_ID.test(savedPaymentMethodId)) {
        throw new PaymentMethodPersistenceError('RESOURCE_NOT_FOUND', 404)
      }

      try {
        const result = await db.query<MandateRow>(
          `SELECT
             m.mandate_record_id,
             m.provider_mandate_id,
             m.payment_method_id,
             m.status
           FROM payment_mandates m
           JOIN saved_payment_methods s
             ON s.provider = m.provider
            AND s.merchant_id = m.merchant_id
            AND s.customer_id = m.customer_id
            AND s.payment_method_id = m.payment_method_id
           WHERE s.saved_payment_method_id = $1
             AND s.provider = $2
             AND s.merchant_id = $3
             AND s.customer_id = $4
           ORDER BY m.created_at ASC, m.mandate_record_id ASC`,
          [savedPaymentMethodId, PROVIDER, merchantId, customerId],
        )
        return result.rows.map((row) => ({
          mandateRecordId: row.mandate_record_id,
          providerMandateId: row.provider_mandate_id,
          paymentMethodId: row.payment_method_id,
          status: row.status,
        }))
      } catch (error) {
        throw mapQueryError(error)
      }
    },
  }
}
