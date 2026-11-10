import {
  PaymentMethodPersistenceError,
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
  return new PaymentMethodPersistenceError('SERVICE_UNAVAILABLE', 503)
}

/**
 * PostgreSQL 18 counterpart for the D1 read boundary. It preserves the exact
 * status precedence, merchant/customer scoping, ordering and 100-row bound.
 */
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
