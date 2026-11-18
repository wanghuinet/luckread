import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js'
import {
  BillingPersistenceError,
  type BillingDocumentDto,
} from './billing-persistence.js'

type PaymentRow = Readonly<{
  payment_id: string
  order_id: string
  customer_id: string
  provider: string
  merchant_id: string
  amount_minor: string | number
  currency: string
  status: string
  provider_updated_at: string | null
  updated_at: string
}>

type OrderRow = Readonly<{
  order_id: string
  customer_id: string
  status: string
  currency: string
  subtotal_minor: string | number
  discount_minor: string | number
  tax_minor: string | number
  total_minor: string | number
  created_at: string
}>

type OrderLineRow = Readonly<{
  item_type: string
  item_ref: string
  item_version: string
  quantity: string | number
  unit_amount_minor: string | number
  line_subtotal_minor: string | number
  line_discount_minor: string | number
  line_tax_minor: string | number
  line_total_minor: string | number
}>

type BillingDocumentRow = Readonly<{
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

export type BillingDocumentPostgresDependencies = Readonly<{
  now?: () => Date
  createDocumentId?: () => string
  createDocumentNumber?: (type: 'INVOICE' | 'RECEIPT') => string
}>

const PROVIDER = 'hyperswitch'
const MAX_SNAPSHOT_BYTES = 65_536
const PAYMENT_ID_PATTERN = /^pay_[A-Za-z0-9]{26}$/

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value)
}

function safeInteger(value: unknown): number | null {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(number) ? number : null
}

function iso(value: unknown): string | null {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function nowIso(now?: () => Date): string {
  const value = (now ?? (() => new Date()))()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return value.toISOString()
}

function defaultDocumentId(): string {
  return 'bdoc_' + crypto.randomUUID()
}

function defaultDocumentNumber(type: 'INVOICE' | 'RECEIPT'): string {
  return (type === 'INVOICE' ? 'INV-' : 'RCT-') + crypto.randomUUID().replace(/-/g, '').toUpperCase()
}

function toDocumentDto(row: BillingDocumentRow): BillingDocumentDto {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(row.snapshot_json) as unknown
  } catch {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const amountMinor = safeInteger(row.amount_minor)
  const issuedAt = iso(row.issued_at)
  const createdAt = iso(row.created_at)
  if (
    typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot) ||
    amountMinor === null || amountMinor <= 0 || !issuedAt || !createdAt
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
    issuedAt,
    createdAt,
  }
}

function snapshotJson(value: Readonly<Record<string, unknown>>): string {
  const serialized = JSON.stringify(value)
  if (new TextEncoder().encode(serialized).byteLength > MAX_SNAPSHOT_BYTES) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return serialized
}

function createIdentity(
  type: 'INVOICE' | 'RECEIPT',
  dependencies: BillingDocumentPostgresDependencies,
): Readonly<{ documentId: string; documentNumber: string }> {
  const documentId = (dependencies.createDocumentId ?? defaultDocumentId)()
  const documentNumber = (dependencies.createDocumentNumber ?? defaultDocumentNumber)(type)
  if (!validId(documentId, 128) || !validId(documentNumber, 128)) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return { documentId, documentNumber }
}

async function readBillingDocument(
  client: W07WebhookPostgresClient,
  customerId: string,
  type: 'INVOICE' | 'RECEIPT',
  orderId: string,
): Promise<BillingDocumentRow | null> {
  const result = await client.query<BillingDocumentRow>(
    'SELECT document_id, document_type, document_number, customer_id, order_id, payment_id, ' +
    'amount_minor::text AS amount_minor, currency, snapshot_json, ' +
    'to_char(issued_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS issued_at, ' +
    'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at ' +
    'FROM billing_documents WHERE customer_id = $1 AND document_type = $2 AND order_id = $3 ' +
    'LIMIT 1 FOR UPDATE',
    [customerId, type, orderId],
  )
  return result.rows[0] ?? null
}

async function readOrderSnapshot(
  client: W07WebhookPostgresClient,
  order: OrderRow,
): Promise<Readonly<{ snapshot: Readonly<Record<string, unknown>>; totalMinor: number }>> {
  const subtotalMinor = safeInteger(order.subtotal_minor)
  const discountMinor = safeInteger(order.discount_minor)
  const taxMinor = safeInteger(order.tax_minor)
  const totalMinor = safeInteger(order.total_minor)
  const orderedAt = iso(order.created_at)
  if (
    subtotalMinor === null || subtotalMinor < 0 ||
    discountMinor === null || discountMinor < 0 ||
    taxMinor === null || taxMinor < 0 ||
    totalMinor === null || totalMinor <= 0 ||
    !/^[A-Z]{3}$/.test(order.currency) || !orderedAt
  ) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
  }

  const selectedLines = await client.query<OrderLineRow>(
    'SELECT item_type, item_ref, item_version, quantity::text AS quantity, ' +
    'unit_amount_minor::text AS unit_amount_minor, line_subtotal_minor::text AS line_subtotal_minor, ' +
    'line_discount_minor::text AS line_discount_minor, line_tax_minor::text AS line_tax_minor, ' +
    'line_total_minor::text AS line_total_minor FROM order_lines ' +
    'WHERE order_id = $1 ORDER BY item_ref ASC, item_version ASC',
    [order.order_id],
  )
  const items = selectedLines.rows.map((line) => {
    const quantity = safeInteger(line.quantity)
    const unitAmountMinor = safeInteger(line.unit_amount_minor)
    const lineSubtotalMinor = safeInteger(line.line_subtotal_minor)
    const lineDiscountMinor = safeInteger(line.line_discount_minor)
    const lineTaxMinor = safeInteger(line.line_tax_minor)
    const lineTotalMinor = safeInteger(line.line_total_minor)
    if (
      !validId(line.item_type, 64) || !validId(line.item_ref, 255) ||
      !validId(line.item_version, 128) || quantity === null || quantity < 1 ||
      unitAmountMinor === null || unitAmountMinor < 0 ||
      lineSubtotalMinor === null || lineSubtotalMinor < 0 ||
      lineDiscountMinor === null || lineDiscountMinor < 0 ||
      lineTaxMinor === null || lineTaxMinor < 0 ||
      lineTotalMinor === null || lineTotalMinor < 0
    ) {
      throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
    }
    return {
      itemType: line.item_type,
      itemRef: line.item_ref,
      itemVersion: line.item_version,
      quantity,
      unitAmountMinor,
      lineSubtotalMinor,
      lineDiscountMinor,
      lineTaxMinor,
      lineTotalMinor,
    }
  })

  return {
    totalMinor,
    snapshot: {
      orderId: order.order_id,
      orderStatusAtIssue: order.status,
      currency: order.currency,
      subtotalMinor,
      discountMinor,
      taxMinor,
      totalMinor,
      orderedAt,
      items,
    },
  }
}

/**
 * Atomically issue or replay the immutable invoice and receipt from the
 * authoritative Neon Payment, Order and OrderLine rows. Provider signature
 * verification and the payment-success CAS happen before this post-commit step.
 */
export async function issueReceiptForPaidPaymentPostgres(
  pool: W07WebhookPostgresPool,
  paymentIdInput: string,
  expectedMerchantIdInput: string,
  dependencies: BillingDocumentPostgresDependencies = {},
): Promise<BillingDocumentDto> {
  if (!PAYMENT_ID_PATTERN.test(paymentIdInput) || !validId(expectedMerchantIdInput, 256)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400)
  }

  const issuedAt = nowIso(dependencies.now)
  let client: W07WebhookPostgresClient
  try {
    client = await pool.connect()
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
  }

  let transactionOpen = false
  try {
    await client.query('BEGIN')
    transactionOpen = true

    const paymentResult = await client.query<PaymentRow>(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor::text AS amount_minor, ' +
      'currency, status, ' +
      'CASE WHEN provider_updated_at IS NULL THEN NULL ELSE ' +
      'to_char(provider_updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') END AS provider_updated_at, ' +
      'to_char(updated_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS updated_at ' +
      'FROM payments WHERE payment_id = $1 AND provider = $2 AND merchant_id = $3 ' +
      'LIMIT 1 FOR UPDATE',
      [paymentIdInput, PROVIDER, expectedMerchantIdInput],
    )
    const payment = paymentResult.rows[0]
    if (!payment) throw new BillingPersistenceError('RESOURCE_NOT_FOUND', 404)

    const amountMinor = safeInteger(payment.amount_minor)
    if (
      payment.status !== 'succeeded' || amountMinor === null || amountMinor <= 0 ||
      !/^[A-Z]{3}$/.test(payment.currency) ||
      !validId(payment.order_id, 255) || !validId(payment.customer_id, 256) ||
      payment.merchant_id !== expectedMerchantIdInput || payment.provider !== PROVIDER
    ) {
      throw new BillingPersistenceError('CONFLICT', 409)
    }

    const existingReceipt = await readBillingDocument(
      client, payment.customer_id, 'RECEIPT', payment.order_id,
    )
    if (existingReceipt) {
      if (existingReceipt.payment_id !== payment.payment_id) {
        throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
      }
      const dto = toDocumentDto(existingReceipt)
      await client.query('COMMIT')
      transactionOpen = false
      return dto
    }

    const orderResult = await client.query<OrderRow>(
      'SELECT order_id, customer_id, status, currency, subtotal_minor::text AS subtotal_minor, ' +
      'discount_minor::text AS discount_minor, tax_minor::text AS tax_minor, total_minor::text AS total_minor, ' +
      'to_char(created_at AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') AS created_at ' +
      'FROM orders WHERE order_id = $1 AND customer_id = $2 LIMIT 1 FOR UPDATE',
      [payment.order_id, payment.customer_id],
    )
    const order = orderResult.rows[0]
    if (!order) throw new BillingPersistenceError('RESOURCE_NOT_FOUND', 404)
    const orderSnapshot = await readOrderSnapshot(client, order)
    if (order.currency !== payment.currency || orderSnapshot.totalMinor !== amountMinor) {
      throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
    }

    const existingInvoice = await readBillingDocument(
      client, payment.customer_id, 'INVOICE', payment.order_id,
    )
    if (existingInvoice) {
      // Validate the retained invoice record even though it is never rewritten.
      toDocumentDto(existingInvoice)
    } else {
      const invoiceIdentity = createIdentity('INVOICE', dependencies)
      const invoiceSnapshotJson = snapshotJson(orderSnapshot.snapshot)
      await client.query(
        'INSERT INTO billing_documents ' +
        '(document_id,document_type,document_number,customer_id,order_id,payment_id,amount_minor,currency,snapshot_json,issued_at,created_at) ' +
        "VALUES ($1,'INVOICE',$2,$3,$4,NULL,$5,$6,$7,$8::timestamptz,$8::timestamptz) " +
        'ON CONFLICT (document_type,order_id) DO NOTHING',
        [invoiceIdentity.documentId, invoiceIdentity.documentNumber, payment.customer_id, payment.order_id,
          amountMinor === orderSnapshot.totalMinor ? orderSnapshot.totalMinor : amountMinor,
          order.currency, invoiceSnapshotJson, issuedAt],
      )
      const insertedInvoice = await readBillingDocument(
        client, payment.customer_id, 'INVOICE', payment.order_id,
      )
      if (!insertedInvoice) throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
      toDocumentDto(insertedInvoice)
    }

    const receiptSnapshot = {
      ...orderSnapshot.snapshot,
      paymentId: payment.payment_id,
      paymentStatusAtIssue: payment.status,
      paidAmountMinor: amountMinor,
      paidCurrency: payment.currency,
      paidAt: iso(payment.provider_updated_at) ?? iso(payment.updated_at),
    }
    if (!receiptSnapshot.paidAt) throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
    const receiptSnapshotJson = snapshotJson(receiptSnapshot)
    const receiptIdentity = createIdentity('RECEIPT', dependencies)
    await client.query(
      'INSERT INTO billing_documents ' +
      '(document_id,document_type,document_number,customer_id,order_id,payment_id,amount_minor,currency,snapshot_json,issued_at,created_at) ' +
      "VALUES ($1,'RECEIPT',$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$9::timestamptz) " +
      'ON CONFLICT (document_type,order_id) DO NOTHING',
      [receiptIdentity.documentId, receiptIdentity.documentNumber, payment.customer_id, payment.order_id,
        payment.payment_id, amountMinor, payment.currency, receiptSnapshotJson, issuedAt],
    )
    const createdReceipt = await readBillingDocument(
      client, payment.customer_id, 'RECEIPT', payment.order_id,
    )
    if (!createdReceipt) throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
    if (createdReceipt.payment_id !== payment.payment_id) {
      throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500)
    }
    const dto = toDocumentDto(createdReceipt)
    await client.query('COMMIT')
    transactionOpen = false
    return dto
  } catch (error) {
    if (transactionOpen) {
      try { await client.query('ROLLBACK') } catch { /* preserve original error */ }
    }
    if (error instanceof BillingPersistenceError) throw error
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503)
  } finally {
    client.release()
  }
}
