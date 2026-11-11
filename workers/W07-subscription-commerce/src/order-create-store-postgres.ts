import {
  OrderPersistenceError,
  type OrderCreateIdempotencyRow,
  type OrderCreatePersistenceStore,
  type OrderCreateTransactionInput,
  type OrderCreateTransactionResult,
} from './order-persistence.js'

type QueryResult<Row extends Record<string, unknown>> = Readonly<{ rows: Row[] }>

/**
 * Structural node-postgres subset. The Worker bundle has no pg runtime
 * dependency; the pool is supplied only by a separately admitted host/runtime.
 */
export interface OrderPersistencePostgresClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  release(): void
}

export interface OrderPersistencePostgresPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>
  connect(): Promise<OrderPersistencePostgresClient>
}

function mapPostgresError(error: unknown): OrderPersistenceError {
  if (error instanceof OrderPersistenceError) return error
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  if (code === '23505') return new OrderPersistenceError('CONFLICT', 409)
  if (code.startsWith('23')) return new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  return new OrderPersistenceError('SERVICE_UNAVAILABLE', 503)
}

/**
 * PostgreSQL 18 adapter for the W07 PAY-002 order-create write boundary.
 *
 * The idempotency claim, completed response, initial Order and every OrderLine
 * are committed on one client transaction. No pricing/network calls occur
 * inside this transaction. D1 remains the production default.
 */
export function createPostgresOrderCreateStore(
  db: OrderPersistencePostgresPool,
): OrderCreatePersistenceStore {
  return {
    async readIdempotencyRow(customerId, idempotencyKey) {
      try {
        const result = await db.query<OrderCreateIdempotencyRow>(
          `SELECT
             id,
             customer_id,
             operation_key,
             idempotency_key,
             request_hash,
             state,
             response_status,
             response_json,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
             to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS expires_at
           FROM order_create_idempotency
           WHERE customer_id = $1
             AND operation_key = $2
             AND idempotency_key = $3
           LIMIT 1`,
          [customerId, 'POST /v1/commerce/orders', idempotencyKey],
        )
        return result.rows[0] ?? null
      } catch (error) {
        throw mapPostgresError(error)
      }
    },

    async persistNewOrder(input: OrderCreateTransactionInput): Promise<OrderCreateTransactionResult> {
      let client: OrderPersistencePostgresClient | null = null
      let settled = false
      try {
        client = await db.connect()
        await client.query('BEGIN')

        const expired = await client.query<{ id: string }>(
          `DELETE FROM order_create_idempotency
           WHERE customer_id = $1
             AND operation_key = $2
             AND idempotency_key = $3
             AND expires_at <= $4
           RETURNING id`,
          [input.customerId, input.operationKey, input.idempotencyKey, input.createdAt],
        )

        const claimed = await client.query<{ id: string }>(
          `INSERT INTO order_create_idempotency
             (id, customer_id, operation_key, idempotency_key, request_hash, state,
              response_status, response_json, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, 'IN_PROGRESS', NULL, NULL, $6, $7)
           ON CONFLICT (customer_id, operation_key, idempotency_key) DO NOTHING
           RETURNING id`,
          [
            input.idempotencyId,
            input.customerId,
            input.operationKey,
            input.idempotencyKey,
            input.requestHash,
            input.createdAt,
            input.expiresAt,
          ],
        )

        if (claimed.rows.length !== 1) {
          // A concurrent request owns the unique scope. Roll back this
          // transaction before the caller reads/replays the committed result.
          await client.query('ROLLBACK')
          settled = true
          return {
            statementCount: 2,
            expireChanges: expired.rows.length,
            claimChanges: 0,
            completionChanges: 0,
            orderChanges: 0,
            lineChanges: [],
          }
        }

        const completed = await client.query<{ id: string }>(
          `UPDATE order_create_idempotency
           SET state = 'COMPLETED', response_status = 201, response_json = $1
           WHERE id = $2
             AND customer_id = $3
             AND operation_key = $4
             AND idempotency_key = $5
             AND request_hash = $6
             AND state = 'IN_PROGRESS'
           RETURNING id`,
          [
            input.responseJson,
            input.idempotencyId,
            input.customerId,
            input.operationKey,
            input.idempotencyKey,
            input.requestHash,
          ],
        )
        if (completed.rows.length !== 1) {
          throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
        }

        const order = await client.query<{ order_id: string }>(
          `INSERT INTO orders
             (order_id, customer_id, status, version, currency, subtotal_minor,
              discount_minor, tax_minor, total_minor, created_at, updated_at,
              confirmed_at, cancelled_at, failure_code)
           SELECT $1, $2, 'CREATED', 1, $3, $4, $5, $6, $7, $8, $9, NULL, NULL, NULL
           WHERE EXISTS (
             SELECT 1
             FROM order_create_idempotency
             WHERE id = $10
               AND customer_id = $11
               AND operation_key = $12
               AND idempotency_key = $13
               AND request_hash = $14
               AND state = 'COMPLETED'
               AND response_json = $15
           )
           RETURNING order_id`,
          [
            input.order.orderId,
            input.customerId,
            input.order.currency,
            input.order.subtotalMinor,
            input.order.discountMinor,
            input.order.taxMinor,
            input.order.totalMinor,
            input.createdAt,
            input.createdAt,
            input.idempotencyId,
            input.customerId,
            input.operationKey,
            input.idempotencyKey,
            input.requestHash,
            input.responseJson,
          ],
        )
        if (order.rows.length !== 1) {
          throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
        }

        const lineChanges: number[] = []
        for (const line of input.lines) {
          const inserted = await client.query<{ order_line_id: string }>(
            `INSERT INTO order_lines
               (order_line_id, order_id, item_type, item_ref, item_version, quantity,
                unit_amount_minor, line_subtotal_minor, line_discount_minor,
                line_tax_minor, line_total_minor, item_snapshot_json, created_at)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
             WHERE EXISTS (
               SELECT 1 FROM orders WHERE order_id = $14 AND customer_id = $15
             )
             RETURNING order_line_id`,
            [
              line.orderLineId,
              input.order.orderId,
              line.item.itemType,
              line.item.itemRef,
              line.item.itemVersion,
              line.item.quantity,
              line.item.unitAmountMinor,
              line.lineSubtotalMinor,
              line.item.lineDiscountMinor,
              line.item.lineTaxMinor,
              line.lineTotalMinor,
              line.item.itemSnapshotJson,
              input.createdAt,
              input.order.orderId,
              input.customerId,
            ],
          )
          lineChanges.push(inserted.rows.length)
          if (inserted.rows.length !== 1) {
            throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
          }
        }

        await client.query('COMMIT')
        settled = true
        return {
          statementCount: lineChanges.length + 4,
          expireChanges: expired.rows.length,
          claimChanges: claimed.rows.length,
          completionChanges: completed.rows.length,
          orderChanges: order.rows.length,
          lineChanges,
        }
      } catch (error) {
        if (client && !settled) {
          try {
            await client.query('ROLLBACK')
          } catch {
            // Preserve the original failure; releasing the client discards the
            // connection if PostgreSQL has already terminated the transaction.
          }
        }
        throw mapPostgresError(error)
      } finally {
        client?.release()
      }
    },
  }
}
