/// <reference types="@cloudflare/workers-types" />

type OrderForBilling = Readonly<{
  order_id: string;
  customer_id: string;
  status: string;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
}>;

type OrderLineForBilling = Readonly<{
  item_type: string;
  item_ref: string;
  item_version: string;
  quantity: number;
  unit_amount_minor: number;
  line_subtotal_minor: number;
  line_discount_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
}>;

type PaymentForBilling = Readonly<{
  payment_id: string;
  order_id: string;
  customer_id: string;
  provider: string;
  merchant_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  version: number;
  provider_updated_at: string | null;
  created_at: string;
  updated_at: string;
}>;

type BillingDocumentRow = Readonly<{
  document_id: string;
  document_type: 'INVOICE' | 'RECEIPT';
  document_number: string;
  customer_id: string;
  order_id: string;
  payment_id: string | null;
  amount_minor: number;
  currency: string;
  snapshot_json: string;
  issued_at: string;
  created_at: string;
}>;

type RefundHistoryRow = Readonly<{
  refund_id: string;
  payment_id: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  reason: string | null;
  version: number;
  provider_updated_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export type BillingDocumentDto = Readonly<{
  documentId: string;
  documentType: 'INVOICE' | 'RECEIPT';
  documentNumber: string;
  orderId: string;
  paymentId: string | null;
  amountMinor: number;
  currency: string;
  snapshot: Readonly<Record<string, unknown>>;
  issuedAt: string;
  createdAt: string;
}>;

export type CustomerPaymentHistoryItem = Readonly<{
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  refundedMinor: number;
}>;

export type CustomerRefundHistoryItem = Readonly<{
  refundId: string;
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  status: string;
  reason: string | null;
  version: number;
  providerUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type BillingList<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

export class BillingPersistenceError extends Error {
  constructor(readonly code: 'VALIDATION_FAILED' | 'RESOURCE_NOT_FOUND' | 'CONFLICT' | 'INTEGRITY_VIOLATION' | 'SERVICE_UNAVAILABLE', readonly status: number) {
    super(code);
    this.name = 'BillingPersistenceError';
  }
}

const PROVIDER = 'hyperswitch';
const MAX_PAGE_SIZE = 50;

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function defaultDocumentId(): string {
  return 'bdoc_' + crypto.randomUUID();
}

function defaultDocumentNumber(type: 'INVOICE' | 'RECEIPT'): string {
  return (type === 'INVOICE' ? 'INV-' : 'RCT-') + crypto.randomUUID().replace(/-/g, '').toUpperCase();
}

function encodeCursor(value: Readonly<{ timestamp: string; id: string }>): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeCursor(value: string | null | undefined): { timestamp: string; id: string } | null {
  if (value == null || value === '') return null;
  if (!/^[A-Za-z0-9_-]{1,512}$/.test(value)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid cursor');
    const candidate = parsed as Record<string, unknown>;
    if (!validIso(candidate.timestamp) || !validId(candidate.id, 255)) throw new Error('invalid cursor');
    if (Object.keys(candidate).length !== 2) throw new Error('invalid cursor');
    return { timestamp: candidate.timestamp, id: candidate.id };
  } catch {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
}

function pageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  return value;
}

function toDocumentDto(row: BillingDocumentRow): BillingDocumentDto {
  let snapshot: unknown;
  try { snapshot = JSON.parse(row.snapshot_json) as unknown; }
  catch { throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500); }
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return {
    documentId: row.document_id,
    documentType: row.document_type,
    documentNumber: row.document_number,
    orderId: row.order_id,
    paymentId: row.payment_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    snapshot: snapshot as Record<string, unknown>,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

async function readDocument(
  db: D1Database,
  customerId: string,
  type: 'INVOICE' | 'RECEIPT',
  orderId: string,
): Promise<BillingDocumentRow | null> {
  return db.prepare(
    'SELECT document_id, document_type, document_number, customer_id, order_id, payment_id, amount_minor, ' +
    'currency, snapshot_json, issued_at, created_at FROM billing_documents ' +
    'WHERE customer_id = ? AND document_type = ? AND order_id = ? LIMIT 1',
  ).bind(customerId, type, orderId).first<BillingDocumentRow>();
}

async function readOwnedOrder(
  db: D1Database,
  customerId: string,
  orderId: string,
): Promise<OrderForBilling> {
  let row: OrderForBilling | null;
  try {
    row = await db.prepare(
      'SELECT order_id, customer_id, status, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_at ' +
      'FROM orders WHERE order_id = ? AND customer_id = ? LIMIT 1',
    ).bind(orderId, customerId).first<OrderForBilling>();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!row) throw new BillingPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (!Number.isSafeInteger(row.total_minor) || row.total_minor <= 0 ||
      !/^[A-Z]{3}$/.test(row.currency) || !validIso(row.created_at)) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return row;
}

async function orderSnapshot(db: D1Database, order: OrderForBilling): Promise<Record<string, unknown>> {
  let lines: OrderLineForBilling[];
  try {
    const result = await db.prepare(
      'SELECT item_type, item_ref, item_version, quantity, unit_amount_minor, line_subtotal_minor, ' +
      'line_discount_minor, line_tax_minor, line_total_minor FROM order_lines ' +
      'WHERE order_id = ? ORDER BY item_ref ASC, item_version ASC',
    ).bind(order.order_id).all<OrderLineForBilling>();
    lines = result.results ?? [];
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  return {
    orderId: order.order_id,
    orderStatusAtIssue: order.status,
    currency: order.currency,
    subtotalMinor: order.subtotal_minor,
    discountMinor: order.discount_minor,
    taxMinor: order.tax_minor,
    totalMinor: order.total_minor,
    orderedAt: order.created_at,
    items: lines.map((line) => ({
      itemType: line.item_type,
      itemRef: line.item_ref,
      itemVersion: line.item_version,
      quantity: line.quantity,
      unitAmountMinor: line.unit_amount_minor,
      lineSubtotalMinor: line.line_subtotal_minor,
      lineDiscountMinor: line.line_discount_minor,
      lineTaxMinor: line.line_tax_minor,
      lineTotalMinor: line.line_total_minor,
    })),
  };
}

/**
 * Issue a customer-owned invoice from the persisted D1-04 Order/OrderLine
 * snapshot. INSERT is idempotent on (document_type, order_id); an already
 * issued invoice is read back, never regenerated or mutated.
 */
export async function issueInvoiceForOrder(
  db: D1Database,
  customerIdInput: string,
  orderIdInput: string,
  dependencies: Readonly<{ now?: () => Date; createDocumentId?: () => string; createDocumentNumber?: () => string }> = {},
): Promise<BillingDocumentDto> {
  if (!validId(customerIdInput) || !validId(orderIdInput, 255)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  const existing = await readDocument(db, customerIdInput, 'INVOICE', orderIdInput).catch(() => {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  });
  if (existing) return toDocumentDto(existing);

  const order = await readOwnedOrder(db, customerIdInput, orderIdInput);
  const snapshot = await orderSnapshot(db, order);
  const snapshotJson = JSON.stringify(snapshot);
  if (new TextEncoder().encode(snapshotJson).byteLength > 65_536) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const issuedAt = nowDate.toISOString();
  const documentId = (dependencies.createDocumentId ?? defaultDocumentId)();
  const documentNumber = (dependencies.createDocumentNumber ?? (() => defaultDocumentNumber('INVOICE')))();
  if (!validId(documentId, 128) || !validId(documentNumber, 128)) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  try {
    await db.prepare(
      'INSERT INTO billing_documents(document_id,document_type,document_number,customer_id,order_id,payment_id,' +
      'amount_minor,currency,snapshot_json,issued_at,created_at) VALUES(?,?,?,?,?,NULL,?,?,?,?,?) ' +
      'ON CONFLICT(document_type,order_id) DO NOTHING',
    ).bind(
      documentId, 'INVOICE', documentNumber, customerIdInput, order.order_id,
      order.total_minor, order.currency, snapshotJson, issuedAt, issuedAt,
    ).run();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const created = await readDocument(db, customerIdInput, 'INVOICE', order.order_id).catch(() => null);
  if (!created) throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  return toDocumentDto(created);
}

/**
 * Issue a receipt only after the payment row has reached succeeded from the
 * verified Hyperswitch webhook path. The unique document_type/order constraint
 * makes webhook replays safe; no callback or browser redirect can issue one.
 */
export async function issueReceiptForPaidPayment(
  db: D1Database,
  paymentIdInput: string,
  expectedMerchantIdInput: string,
  dependencies: Readonly<{ now?: () => Date; createDocumentId?: () => string; createDocumentNumber?: () => string }> = {},
): Promise<BillingDocumentDto> {
  if (!/^pay_[A-Za-z0-9]{26}$/.test(paymentIdInput) || !validId(expectedMerchantIdInput, 256)) {
    throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  }
  let payment: PaymentForBilling | null;
  try {
    payment = await db.prepare(
      'SELECT payment_id, order_id, customer_id, provider, merchant_id, amount_minor, currency, status, version, ' +
      'provider_updated_at, created_at, updated_at FROM payments ' +
      'WHERE payment_id = ? AND provider = ? AND merchant_id = ? LIMIT 1',
    ).bind(paymentIdInput, PROVIDER, expectedMerchantIdInput).first<PaymentForBilling>();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  if (!payment) throw new BillingPersistenceError('RESOURCE_NOT_FOUND', 404);
  if (payment.status !== 'succeeded' || !Number.isSafeInteger(payment.amount_minor) ||
      payment.amount_minor <= 0 || !/^[A-Z]{3}$/.test(payment.currency)) {
    throw new BillingPersistenceError('CONFLICT', 409);
  }

  const existing = await readDocument(db, payment.customer_id, 'RECEIPT', payment.order_id).catch(() => {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  });
  if (existing) {
    if (existing.payment_id !== payment.payment_id) {
      throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    return toDocumentDto(existing);
  }

  const order = await readOwnedOrder(db, payment.customer_id, payment.order_id);
  if (order.currency !== payment.currency || order.total_minor !== payment.amount_minor) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  await issueInvoiceForOrder(db, payment.customer_id, payment.order_id, dependencies);
  const invoiceSnapshot = await orderSnapshot(db, order);
  const snapshot = {
    ...invoiceSnapshot,
    paymentId: payment.payment_id,
    paymentStatusAtIssue: payment.status,
    paidAmountMinor: payment.amount_minor,
    paidCurrency: payment.currency,
    paidAt: payment.provider_updated_at ?? payment.updated_at,
  };
  const snapshotJson = JSON.stringify(snapshot);
  if (new TextEncoder().encode(snapshotJson).byteLength > 65_536) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const nowDate = (dependencies.now ?? (() => new Date()))();
  if (!(nowDate instanceof Date) || !Number.isFinite(nowDate.getTime())) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const issuedAt = nowDate.toISOString();
  const documentId = (dependencies.createDocumentId ?? defaultDocumentId)();
  const documentNumber = (dependencies.createDocumentNumber ?? (() => defaultDocumentNumber('RECEIPT')))();
  if (!validId(documentId, 128) || !validId(documentNumber, 128)) {
    throw new BillingPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  try {
    await db.prepare(
      'INSERT INTO billing_documents(document_id,document_type,document_number,customer_id,order_id,payment_id,' +
      'amount_minor,currency,snapshot_json,issued_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?) ' +
      'ON CONFLICT(document_type,order_id) DO NOTHING',
    ).bind(
      documentId, 'RECEIPT', documentNumber, payment.customer_id, payment.order_id, payment.payment_id,
      payment.amount_minor, payment.currency, snapshotJson, issuedAt, issuedAt,
    ).run();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const created = await readDocument(db, payment.customer_id, 'RECEIPT', payment.order_id).catch(() => null);
  if (!created || created.payment_id !== payment.payment_id) {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  return toDocumentDto(created);
}

export async function listBillingDocumentsForCustomer(
  db: D1Database,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<BillingDocumentDto>> {
  if (!validId(customerIdInput)) throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  const limit = pageSize(limitInput);
  const cursor = decodeCursor(cursorInput);
  let result: D1Result<BillingDocumentRow>;
  try {
    result = cursor
      ? await db.prepare(
          'SELECT document_id, document_type, document_number, customer_id, order_id, payment_id, amount_minor, currency, snapshot_json, issued_at, created_at ' +
          'FROM billing_documents WHERE customer_id = ? AND (issued_at < ? OR (issued_at = ? AND document_id < ?)) ' +
          'ORDER BY issued_at DESC, document_id DESC LIMIT ?',
        ).bind(customerIdInput, cursor.timestamp, cursor.timestamp, cursor.id, limit + 1).all<BillingDocumentRow>()
      : await db.prepare(
          'SELECT document_id, document_type, document_number, customer_id, order_id, payment_id, amount_minor, currency, snapshot_json, issued_at, created_at ' +
          'FROM billing_documents WHERE customer_id = ? ORDER BY issued_at DESC, document_id DESC LIMIT ?',
        ).bind(customerIdInput, limit + 1).all<BillingDocumentRow>();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toDocumentDto),
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.issued_at, id: last.document_id }) : null,
    hasMore,
  };
}

export async function listPaymentHistoryForCustomer(
  db: D1Database,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<CustomerPaymentHistoryItem>> {
  if (!validId(customerIdInput)) throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  const limit = pageSize(limitInput);
  const cursor = decodeCursor(cursorInput);
  let result: D1Result<PaymentForBilling & { refunded_minor: number }>;
  const columns =
    'SELECT p.payment_id, p.order_id, p.customer_id, p.provider, p.merchant_id, p.amount_minor, p.currency, ' +
    'p.status, p.version, p.provider_updated_at, p.created_at, p.updated_at, ' +
    "COALESCE((SELECT SUM(r.amount_minor) FROM refunds r WHERE r.payment_id = p.payment_id AND r.status = 'SUCCEEDED'), 0) AS refunded_minor " +
    'FROM payments p WHERE p.customer_id = ?';
  try {
    result = cursor
      ? await db.prepare(columns +
          ' AND (p.created_at < ? OR (p.created_at = ? AND p.payment_id < ?)) ' +
          'ORDER BY p.created_at DESC, p.payment_id DESC LIMIT ?')
          .bind(customerIdInput, cursor.timestamp, cursor.timestamp, cursor.id, limit + 1)
          .all<PaymentForBilling & { refunded_minor: number }>()
      : await db.prepare(columns + ' ORDER BY p.created_at DESC, p.payment_id DESC LIMIT ?')
          .bind(customerIdInput, limit + 1)
          .all<PaymentForBilling & { refunded_minor: number }>();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      paymentId: row.payment_id,
      orderId: row.order_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      version: row.version,
      providerUpdatedAt: row.provider_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      refundedMinor: Number.isSafeInteger(row.refunded_minor) && row.refunded_minor >= 0 ? row.refunded_minor : 0,
    })),
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.created_at, id: last.payment_id }) : null,
    hasMore,
  };
}

export async function listRefundHistoryForCustomer(
  db: D1Database,
  customerIdInput: string,
  limitInput = 20,
  cursorInput?: string | null,
): Promise<BillingList<CustomerRefundHistoryItem>> {
  if (!validId(customerIdInput)) throw new BillingPersistenceError('VALIDATION_FAILED', 400);
  const limit = pageSize(limitInput);
  const cursor = decodeCursor(cursorInput);
  let result: D1Result<RefundHistoryRow>;
  const base = 'SELECT refund_id, payment_id, order_id, amount_minor, currency, status, reason, version, provider_updated_at, created_at, updated_at ' +
    'FROM refunds WHERE customer_id = ?';
  try {
    result = cursor
      ? await db.prepare(base + ' AND (created_at < ? OR (created_at = ? AND refund_id < ?)) ORDER BY created_at DESC, refund_id DESC LIMIT ?')
          .bind(customerIdInput, cursor.timestamp, cursor.timestamp, cursor.id, limit + 1)
          .all<RefundHistoryRow>()
      : await db.prepare(base + ' ORDER BY created_at DESC, refund_id DESC LIMIT ?')
          .bind(customerIdInput, limit + 1)
          .all<RefundHistoryRow>();
  } catch {
    throw new BillingPersistenceError('SERVICE_UNAVAILABLE', 503);
  }
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      refundId: row.refund_id,
      paymentId: row.payment_id,
      orderId: row.order_id,
      amountMinor: row.amount_minor,
      currency: row.currency,
      status: row.status,
      reason: row.reason,
      version: row.version,
      providerUpdatedAt: row.provider_updated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    nextCursor: hasMore && last ? encodeCursor({ timestamp: last.created_at, id: last.refund_id }) : null,
    hasMore,
  };
}
