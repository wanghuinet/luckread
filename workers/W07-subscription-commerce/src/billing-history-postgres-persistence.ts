import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  BillingPersistenceError,
  decodeBillingHistoryCursor,
  encodeBillingHistoryCursor,
  isValidBillingId,
  validateBillingPageSize,
  type BillingDocumentDto,
  type BillingHistoryCursor,
  type BillingList,
  type CustomerPaymentHistoryItem,
  type CustomerRefundHistoryItem,
} from './billing-persistence.js'

type PostgresRows<Row extends Record<string, unknown>> = Readonly<{ rows: Row[] }>

type BillingDocumentPostgresRow = Readonly<{
  document_id: string
  document_type: 'INVOICE' | 'RECEIPT'
  document_number: string
  customer_id: string
  order_id: string
  payment_id: string | null
  amount_minor: string | number
  currency: string
  snapshot_json: string
  issued_at: string
  created_at: string
}>

type PaymentHistoryPostgresRow = Readonly<{
  payment_id: string
  order_id: string
  amount_minor: string | number
  currency: string
  status: string
  version: string | number
  provider_updated_at: string | null
  created_at: string
  updated_at: string
  refunded_minor: string | number
}>

type RefundHistoryPostgresRow = Readonly<{
  refund_id: string
  payment_id: string
  order_id: string
  amount_minor: string | number
  currency: string
  status: string
  reason: string | null
  version: string | number
  provider_updated_at: string | null
  created_at: string
  updated_at: string
}>

const MAX_SNAPSHOT_BYTES = 65_536

function safeInteger(value: unknown): number | null {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
}

function mapDocument(row: BillingDocumentPostgresRow): BillingDocumentDto {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(row.snapshot_json) as unknown
  } catch {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const amountMinor = safeInteger(row.amount_minor)
  if (
    !isValidBillingId(row.document_id, 128) ||
    !isValidBillingId(row.document_number, 128) ||
    !isValidBillingId(row.customer_id, 256) ||
    !isValidBillingId(row.order_id, 255) ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    (row.document_type !== 'INVOICE' && row.document_type !== 'RECEIPT') ||
    (row.document_type === 'INVOICE' && row.payment_id !== null) ||
    (row.document_type === 'RECEIPT' && !isValidBillingId(row.payment_id, 30)) ||
    amountMinor === null || amountMinor <= 0 ||
    !validTimestamp(row.issued_at) || !validTimestamp(row.created_at) ||
    typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot) ||
    new TextEncoder().encode(row.snapshot_json).byteLength > MAX_SNAPSHOT_BYTES
  ) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return {
    documentId: row.document_id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    orderId: row.order_id,
    paymentId: row.payment_id,
    amountMinor,
    currency: row.currency,
    snapshot: snapshot as Readonly<Record<string, unknown>>,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  }
}

function mapPayment(row: PaymentHistoryPostgresRow): CustomerPaymentHistoryItem {
  const amountMinor = safeInteger(row.amount_minor)
  const version = safeInteger(row.version)
  const refundedMinor = safeInteger(row.refunded_minor)
  if (
    !isValidBillingId(row.payment_id, 30) ||
    !isValidBillingId(row.order_id, 255) ||
    amountMinor === null || amountMinor <= 0 ||
    version === null || version < 1 ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    !isValidBillingId(row.status, 64) ||
    (row.provider_updated_at !== null && !validTimestamp(row.provider_updated_at)) ||
    !validTimestamp(row.created_at) || !validTimestamp(row.updated_at)
  ) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return {
    paymentId: row.payment_id,
    orderId: row.order_id,
    amountMinor,
    currency: row.currency,
    status: row.status,
    version,
    providerUpdatedAt: row.provider_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    refundedMinor: refundedMinor !== null && refundedMinor >= 0 ? refundedMinor : 0,
  }
}

function mapRefund(row: RefundHistoryPostgresRow): CustomerRefundHistoryItem {
  const amountMinor = safeInteger(row.amount_minor)
  const version = safeInteger(row.version)
  if (
    !isValidBillingId(row.refund_id, 30) ||
    !isValidBillingId(row.payment_id, 30) ||
    !isValidBillingId(row.order_id, 255) ||
    amountMinor === null || amountMinor <= 0 ||
    version === null || version < 1 ||
    !/^[A-Z]{3}$/.test(row.currency) ||
    !isValidBillingId(row.status, 64) ||
    (row.reason !== null && !isValidBillingId(row.reason, 255)) ||
    (row.provider_updated_at !== null && !validTimestamp(row.provider_updated_at)) ||
    !validTimestamp(row.created_at) || !validTimestamp(row.updated_at)
  ) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return {
    refundId: row.refund_id,
    paymentId: row.payment_id,
    orderId: row.order_id,
    amountMinor,
    currency: row.currency,
    status: row.status,
    reason: row.reason,
    version,
    providerUpdatedAt: row.provider_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function page<T, Row extends Record<string, unknown>>(
  rows: readonly Row[],
  limit: number,
  identify: (row: Row) => string,
  timestamp: (row: Row) => string,
  map: (row: Row) => T,
): BillingList<T> {
  const hasMore = rows.length > limit
  const selected = rows.slice(0, limit)
  const last = selected.at(-1)
  return {
    items: selected.map(map),
    nextCursor: hasMore && last
      ? encodeBillingHistoryCursor({ timestamp: timestamp(last), id: identify(last) })
      : null,
    hasMore,
  }
}

function validateRequest(
  customerId: string,
  limitInput: number,
  cursorInput?: string | null,
): Readonly<{ limit: number; cursor: BillingHistoryCursor | null }> {
  if (!isValidBillingId(customerId)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400)
  }
  return {
    limit: validateBillingPageSize(limitInput),
    cursor: decodeBillingHistoryCursor(cursorInput),
  }
}

const DOCUMENT_COLUMNS =
  'document_id, document_type, document_number, customer_id, order_id, payment_id, ' +
  'amount_minor::text AS amount_minor, currency, snapshot_json, ' +
  'to_char(issued_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS issued_at, ' +
  'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at'

const PAYMENT_COLUMNS =
  'p.payment_id, p.order_id, p.amount_minor::text AS amount_minor, p.currency, p.status, ' +
  'p.version::text AS version, ' +
  'CASE WHEN p.provider_updated_at IS NULL THEN NULL ELSE ' +
  'to_char(p.provider_updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') END AS provider_updated_at, ' +
  'to_char(p.created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at, ' +
  'to_char(p.updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at, ' +
  'COALESCE((SELECT SUM(r.amount_minor) FROM refunds r ' +
  "WHERE r.payment_id = p.payment_id AND r.status = 'SUCCEEDED'), 0)::text AS refunded_minor"

const REFUND_COLUMNS =
  'refund_id, payment_id, order_id, amount_minor::text AS amount_minor, currency, status, reason, ' +
  'version::text AS version, ' +
  'CASE WHEN provider_updated_at IS NULL THEN NULL ELSE ' +
  'to_char(provider_updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') END AS provider_updated_at, ' +
  'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at, ' +
  'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at'

/** Native PostgreSQL keyset reads for W07 customer billing history. */
export async function listBillingDocumentsForCustomerPostgres(
  pool: W07WebhookPostgresPool,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<BillingDocumentDto>> {
  const { limit, cursor } = validateRequest(customerIdInput, limitInput, cursorInput)
  const sql = cursor
    ? 'SELECT ' + DOCUMENT_COLUMNS + ' FROM billing_documents WHERE customer_id = $1 ' +
      'AND (issued_at < $2::timestamptz OR (issued_at = $2::timestamptz AND document_id < $3)) ' +
      'ORDER BY issued_at DESC, document_id DESC LIMIT $4'
    : 'SELECT ' + DOCUMENT_COLUMNS + ' FROM billing_documents WHERE customer_id = $1 ' +
      'ORDER BY issued_at DESC, document_id DESC LIMIT $2'
  const values = cursor
    ? [customerIdInput, cursor.timestamp, cursor.id, limit + 1]
    : [customerIdInput, limit + 1]
  let result: PostgresRows<BillingDocumentPostgresRow>
  try {
    result = await pool.query<BillingDocumentPostgresRow>(sql, values)
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return page(result.rows, limit, (row) => row.document_id, (row) => row.issued_at, mapDocument)
}

export async function listPaymentHistoryForCustomerPostgres(
  pool: W07WebhookPostgresPool,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<CustomerPaymentHistoryItem>> {
  const { limit, cursor } = validateRequest(customerIdInput, limitInput, cursorInput)
  const base = 'SELECT ' + PAYMENT_COLUMNS + ' FROM payments p WHERE p.customer_id = $1'
  const sql = cursor
    ? base + ' AND (p.created_at < $2::timestamptz OR (p.created_at = $2::timestamptz AND p.payment_id < $3)) ' +
      'ORDER BY p.created_at DESC, p.payment_id DESC LIMIT $4'
    : base + ' ORDER BY p.created_at DESC, p.payment_id DESC LIMIT $2'
  const values = cursor
    ? [customerIdInput, cursor.timestamp, cursor.id, limit + 1]
    : [customerIdInput, limit + 1]
  let result: PostgresRows<PaymentHistoryPostgresRow>
  try {
    result = await pool.query<PaymentHistoryPostgresRow>(sql, values)
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return page(result.rows, limit, (row) => row.payment_id, (row) => row.created_at, mapPayment)
}

export async function listRefundHistoryForCustomerPostgres(
  pool: W07WebhookPostgresPool,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<CustomerRefundHistoryItem>> {
  const { limit, cursor } = validateRequest(customerIdInput, limitInput, cursorInput)
  const base = 'SELECT ' + REFUND_COLUMNS + ' FROM refunds WHERE customer_id = $1'
  const sql = cursor
    ? base + ' AND (created_at < $2::timestamptz OR (created_at = $2::timestamptz AND refund_id < $3)) ' +
      'ORDER BY created_at DESC, refund_id DESC LIMIT $4'
    : base + ' ORDER BY created_at DESC, refund_id DESC LIMIT $2'
  const values = cursor
    ? [customerIdInput, cursor.timestamp, cursor.id, limit + 1]
    : [customerIdInput, limit + 1]
  let result: PostgresRows<RefundHistoryPostgresRow>
  try {
    result = await pool.query<RefundHistoryPostgresRow>(sql, values)
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
  }
  return page(result.rows, limit, (row) => row.refund_id, (row) => row.created_at, mapRefund)
}
