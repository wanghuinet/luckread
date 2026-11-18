import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import type { PaymentAttemptStatus } from './payment-persistence.js'

export type RenewalPaymentAttemptRow = Readonly<{
  payment_id: string
  order_id: string
  customer_id: string
  provider: string
  merchant_id: string
  amount_minor: number
  currency: string
  status: PaymentAttemptStatus
  version: number
  idempotency_key: string
  request_hash: string
  provider_updated_at: string | null
  failure_code: string | null
  created_at: string
  updated_at: string
}>

export async function readRenewalPaymentAttemptPostgres(
  pool: W07WebhookPostgresPool,
  paymentId: string,
  customerId: string,
): Promise<RenewalPaymentAttemptRow | null> {
  try {
    const result = await pool.query<RenewalPaymentAttemptRow & Record<string, unknown>>(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, ' +
      'amount_minor::double precision AS amount_minor, currency, status, version::double precision AS version, ' +
      'idempotency_key, request_hash, ' +
      `CASE WHEN provider_updated_at IS NULL THEN NULL ELSE to_char(provider_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END AS provider_updated_at, ` +
      'failure_code, ' +
      `to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at, ` +
      `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at ` +
      'FROM payments WHERE payment_id = $1 AND customer_id = $2 LIMIT 1',
      [paymentId, customerId],
    )
    return result.rows[0] ?? null
  } catch {
    throw new Error('W07_RENEWAL_PAYMENT_POSTGRES_UNAVAILABLE')
  }
}
