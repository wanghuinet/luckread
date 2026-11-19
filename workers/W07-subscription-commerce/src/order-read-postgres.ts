import type { W07WebhookPostgresPool, W07WebhookPostgresClient } from './payment-webhook-database-postgres.js'
import {
  OrderPersistenceError,
  parseStoredOrderData,
  readSnapshotPricingMode,
  type CommerceOrderData,
} from './order-persistence.js'

type OrderRow = Readonly<{
  order_id: string
  status: string
  version: string | number
  currency: string
  subtotal_minor: string | number
  discount_minor: string | number
  tax_minor: string | number
  total_minor: string | number
  created_at: string
  updated_at: string
}>

type OrderLineRow = Readonly<{
  item_ref: string
  quantity: string | number
  unit_amount_minor: string | number
  line_subtotal_minor: string | number
  line_discount_minor: string | number
  line_tax_minor: string | number
  line_total_minor: string | number
  item_snapshot_json: string
}>

function safeInteger(value: unknown): number {
  const result = typeof value === 'number' ? value :
    typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : Number.NaN
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return result
}

function validateIdentifier(value: unknown, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400)
  }
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
}

/**
 * Read an owner-scoped Order and immutable OrderLines from the D1-04 Neon
 * finance pool. A repeatable-read, read-only transaction keeps the order
 * header and line snapshot consistent without spanning the D1-01 database.
 */
export async function getCommerceOrderPostgres(
  pool: W07WebhookPostgresPool,
  customerIdInput: string,
  orderIdInput: string,
): Promise<CommerceOrderData> {
  validateIdentifier(customerIdInput, 256)
  validateIdentifier(orderIdInput, 255)

  let client: W07WebhookPostgresClient
  try {
    client = await pool.connect()
  } catch {
    throw new OrderPersistenceError('SERVICE_UNAVAILABLE', 503)
  }

  let transactionOpen = false
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    transactionOpen = true

    const orderResult = await client.query<OrderRow>(
      'SELECT order_id, status, version::text AS version, currency, ' +
      'subtotal_minor::text AS subtotal_minor, discount_minor::text AS discount_minor, ' +
      'tax_minor::text AS tax_minor, total_minor::text AS total_minor, ' +
      'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS created_at, ' +
      'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\') AS updated_at ' +
      'FROM orders WHERE order_id = $1 AND customer_id = $2 LIMIT 1',
      [orderIdInput, customerIdInput],
    )
    const order = orderResult.rows[0]
    if (!order) throw new OrderPersistenceError('RESOURCE_NOT_FOUND', 404)

    const linesResult = await client.query<OrderLineRow>(
      'SELECT item_ref, quantity::text AS quantity, unit_amount_minor::text AS unit_amount_minor, ' +
      'line_subtotal_minor::text AS line_subtotal_minor, line_discount_minor::text AS line_discount_minor, ' +
      'line_tax_minor::text AS line_tax_minor, line_total_minor::text AS line_total_minor, item_snapshot_json ' +
      'FROM order_lines WHERE order_id = $1 ORDER BY order_line_id ASC',
      [orderIdInput],
    )
    const lines = linesResult.rows
    const pricingModes = lines.map((line) => readSnapshotPricingMode(line.item_snapshot_json))
    const firstPricingMode = pricingModes[0] ?? 'live'
    if (pricingModes.some((mode) => mode !== firstPricingMode)) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
    }

    if (!isoTimestamp(order.created_at) || !isoTimestamp(order.updated_at)) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
    }

    const publicData = {
      orderId: order.order_id,
      status: order.status,
      version: safeInteger(order.version),
      currency: order.currency,
      subtotalMinor: safeInteger(order.subtotal_minor),
      discountMinor: safeInteger(order.discount_minor),
      taxMinor: safeInteger(order.tax_minor),
      totalMinor: safeInteger(order.total_minor),
      items: lines.map((line) => ({
        itemRef: line.item_ref,
        quantity: safeInteger(line.quantity),
        unitAmountMinor: safeInteger(line.unit_amount_minor),
        lineSubtotalMinor: safeInteger(line.line_subtotal_minor),
        lineDiscountMinor: safeInteger(line.line_discount_minor),
        lineTaxMinor: safeInteger(line.line_tax_minor),
        lineTotalMinor: safeInteger(line.line_total_minor),
      })),
      createdAt: order.created_at,
      updatedAt: order.updated_at,
    }
    const data = parseStoredOrderData(JSON.stringify(publicData))

    await client.query('COMMIT')
    transactionOpen = false
    return data
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK')
      } catch {
        // Preserve the original error; release will discard an aborted connection.
      }
    }
    if (error instanceof OrderPersistenceError) throw error
    throw new OrderPersistenceError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}
