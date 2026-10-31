/// <reference types="@cloudflare/workers-types" />

import { sha256CanonicalJsonForIdempotency } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  MAX_ORDER_ITEMS,
  MAX_ORDER_ITEM_REF_LENGTH,
  validateCreateCommerceOrderRequest,
  validateOrderCreateIdempotencyKey,
  type CreateCommerceOrderRequest,
} from './order-request-validation.js';

const OPERATION_KEY = 'POST /v1/commerce/orders';
const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_MINOR = Number.MAX_SAFE_INTEGER;
const MAX_SNAPSHOT_BYTES = 65_536;

export type CommerceOrderStatus =
  | 'CREATED'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED';

export type CommerceOrderLineDto = Readonly<{
  itemRef: string;
  quantity: number;
  unitAmountMinor: number;
  lineSubtotalMinor: number;
  lineDiscountMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
}>;

export type CommerceOrderData = Readonly<{
  orderId: string;
  status: CommerceOrderStatus;
  version: number;
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  items: readonly CommerceOrderLineDto[];
  createdAt: string;
  updatedAt: string;
}>;

/**
 * Result of authoritative offer + pricing resolution. In particular,
 * discount/tax are required outputs: this persistence layer never invents a
 * discount or assumes that taxes are universally zero.
 */
export type AuthoritativelyPricedOrderItem = Readonly<{
  itemType: 'CONTENT' | 'MEMBERSHIP_PLAN' | 'DIGITAL_GOOD' | 'BUNDLE';
  itemRef: string;
  itemVersion: string;
  quantity: number;
  unitAmountMinor: number;
  currency: string;
  lineDiscountMinor: number;
  lineTaxMinor: number;
  itemSnapshotJson: string;
}>;

export type AuthoritativelyPricedOrder = Readonly<{
  currency: string;
  /** Missing means the existing production adapter; Demo must opt in explicitly. */
  pricingMode?: 'live' | 'demo';
  items: readonly AuthoritativelyPricedOrderItem[];
}>;

export type OrderPersistenceErrorCode =
  | 'VALIDATION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'RESOURCE_NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REUSE_CONFLICT'
  | 'IDEMPOTENCY_IN_PROGRESS'
  | 'INTEGRITY_VIOLATION';

export class OrderPersistenceError extends Error {
  constructor(readonly code: OrderPersistenceErrorCode, readonly status: number) {
    super(code);
    this.name = 'OrderPersistenceError';
  }
}

type IdempotencyRow = {
  id: string;
  customer_id: string;
  operation_key: string;
  idempotency_key: string;
  request_hash: string;
  state: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  response_status: number | null;
  response_json: string | null;
  created_at: string;
  expires_at: string;
};

type OrderRow = {
  order_id: string;
  customer_id: string;
  status: CommerceOrderStatus;
  version: number;
  currency: string;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
  updated_at: string;
};

type OrderLineRow = {
  order_line_id: string;
  order_id: string;
  item_type: string;
  item_ref: string;
  item_version: string;
  quantity: number;
  unit_amount_minor: number;
  line_subtotal_minor: number;
  line_discount_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
  item_snapshot_json: string;
  created_at: string;
};

export type CreateOrderResult = Readonly<{
  data: CommerceOrderData;
  status: number;
  replayed: boolean;
}>;

export type OrderPersistenceDependencies = Readonly<{
  now?: () => Date;
  createId?: (kind: 'order' | 'line' | 'idempotency') => string;
  /** Internal recurring-cycle or domain-workflow orders may use a durable key beyond the default 24h window. */
  idempotencyExpiresAt?: string;
  /** Server-derived domain scope bound into the existing order idempotency fingerprint. */
  idempotencyContext?: string;
}>;

const defaultId = (kind: 'order' | 'line' | 'idempotency'): string =>
  (kind === 'order' ? 'ord_' : kind === 'line' ? 'orl_' : 'idem_') + crypto.randomUUID();

const requireIdentifier = (value: string, field: string, maxLength = 256): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }
  if (!field) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  return value;
};

const assertSafeMinor = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MINOR) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }
  return value;
};

const checkedAdd = (left: number, right: number): number => {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_SAFE_MINOR) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }
  return result;
};

const checkedMultiply = (left: number, right: number): number => {
  const result = left * right;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_SAFE_MINOR) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }
  return result;
};

// Every admitted itemRef is at most 255 UTF-16 code units; JSON escaping can
// expand a code unit to six ASCII bytes. Include bounded per-item JSON syntax.
const MAX_ORDER_CANONICAL_REQUEST_BYTES = MAX_ORDER_ITEMS * (MAX_ORDER_ITEM_REF_LENGTH * 6 + 64) + 128;

const canonicalRequestPayload = (request: CreateCommerceOrderRequest) => ({
  // Item order has no business meaning in this API; sort the closed DTO
  // deterministically so retries for the same basket share one fingerprint.
  items: request.items
    .map(({ itemRef, quantity }) => ({ itemRef, quantity }))
    .sort((left, right) => left.itemRef < right.itemRef ? -1 : left.itemRef > right.itemRef ? 1 : 0),
});

const orderRequestHash = async (request: CreateCommerceOrderRequest, context?: string): Promise<string> => {
  // Existing PAY-002 rows store the bare 64-character hex digest. Preserve that
  // persisted format while delegating canonical JSON and SHA-256 to W10.
  // Internal domain workflows may bind an additional server-derived scope into
  // the fingerprint without exposing that scope as a client-writable order field.
  if (context !== undefined && (typeof context !== 'string' || context.length < 1 || context.length > 4096)) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }
  const canonical = canonicalRequestPayload(request);
  const payload = context === undefined ? canonical : { ...canonical, idempotencyContext: context };
  const fingerprint = await sha256CanonicalJsonForIdempotency(
    payload,
    MAX_ORDER_CANONICAL_REQUEST_BYTES + 4096,
  );
  return fingerprint.slice('sha256:'.length);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function readSnapshotPricingMode(raw: string): 'live' | 'demo' {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  if (!isRecord(parsed)) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  if (!Object.prototype.hasOwnProperty.call(parsed, 'luckreadPricing')) return 'live'
  if (!isRecord(parsed.luckreadPricing) || parsed.luckreadPricing.mode !== 'demo') {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  return 'demo'
}

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const isFiniteIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

const isValidOrderStatus = (value: unknown): value is CommerceOrderStatus =>
  value === 'CREATED' || value === 'PENDING_PAYMENT' || value === 'CONFIRMED' ||
  value === 'PROCESSING' || value === 'COMPLETED' || value === 'CANCELLED' || value === 'FAILED';

const parseStoredOrderData = (raw: string): CommerceOrderData => {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  const legacyOrderKeys = [
    'orderId', 'status', 'version', 'currency', 'subtotalMinor', 'discountMinor',
    'taxMinor', 'totalMinor', 'items', 'createdAt', 'updatedAt',
  ] as const
  if (!isRecord(value) || !(exactKeys(value, legacyOrderKeys) ||
      exactKeys(value, [...legacyOrderKeys, 'pricingMode']))) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const pricingMode = value.pricingMode === undefined ? 'live' : value.pricingMode
  if (pricingMode !== 'live' && pricingMode !== 'demo') {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }

  if (typeof value.orderId !== 'string' || value.orderId.length < 1 || value.orderId.length > 255 ||
      !isValidOrderStatus(value.status) || !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
      typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency) ||
      !isFiniteIsoDate(value.createdAt) || !isFiniteIsoDate(value.updatedAt) ||
      !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 50) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const subtotal = assertStoredMinor(value.subtotalMinor);
  const discount = assertStoredMinor(value.discountMinor);
  const tax = assertStoredMinor(value.taxMinor);
  const total = assertStoredMinor(value.totalMinor);
  if (discount > subtotal || total !== subtotal - discount + tax || !Number.isSafeInteger(total)) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const items: CommerceOrderLineDto[] = value.items.map((candidate): CommerceOrderLineDto => {
    if (!isRecord(candidate) || !exactKeys(candidate, [
      'itemRef', 'quantity', 'unitAmountMinor', 'lineSubtotalMinor',
      'lineDiscountMinor', 'lineTaxMinor', 'lineTotalMinor',
    ]) || typeof candidate.itemRef !== 'string' || candidate.itemRef.length < 1 ||
      candidate.itemRef.length > 255 || !Number.isSafeInteger(candidate.quantity) ||
      (candidate.quantity as number) < 1 || (candidate.quantity as number) > 10000) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    const quantity = candidate.quantity as number;
    const unit = assertStoredMinor(candidate.unitAmountMinor);
    const lineSubtotal = assertStoredMinor(candidate.lineSubtotalMinor);
    const lineDiscount = assertStoredMinor(candidate.lineDiscountMinor);
    const lineTax = assertStoredMinor(candidate.lineTaxMinor);
    const lineTotal = assertStoredMinor(candidate.lineTotalMinor);
    if (lineSubtotal !== unit * quantity || !Number.isSafeInteger(lineSubtotal) ||
        lineDiscount > lineSubtotal || lineTotal !== lineSubtotal - lineDiscount + lineTax ||
        !Number.isSafeInteger(lineTotal)) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    return {
      itemRef: candidate.itemRef,
      quantity,
      unitAmountMinor: unit,
      lineSubtotalMinor: lineSubtotal,
      lineDiscountMinor: lineDiscount,
      lineTaxMinor: lineTax,
      lineTotalMinor: lineTotal,
    };
  });

  if (new Set(items.map((item) => item.itemRef)).size !== items.length) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const sum = (selector: (item: CommerceOrderLineDto) => number): number =>
    items.reduce((totalSoFar, item) => checkedAdd(totalSoFar, selector(item)), 0);
  if (sum((item) => item.lineSubtotalMinor) !== subtotal ||
      sum((item) => item.lineDiscountMinor) !== discount ||
      sum((item) => item.lineTaxMinor) !== tax ||
      sum((item) => item.lineTotalMinor) !== total) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  return {
    orderId: value.orderId,
    status: value.status,
    version: value.version as number,
    currency: value.currency,
    subtotalMinor: subtotal,
    discountMinor: discount,
    taxMinor: tax,
    totalMinor: total,
    items,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
};

const assertStoredMinor = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MINOR) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return value;
};

const readIdempotencyRow = async (
  db: D1Database,
  customerId: string,
  idempotencyKey: string,
): Promise<IdempotencyRow | null> => db.prepare(
  'SELECT id, customer_id, operation_key, idempotency_key, request_hash, state, response_status, response_json, created_at, expires_at ' +
  'FROM order_create_idempotency WHERE customer_id = ? AND operation_key = ? AND idempotency_key = ? LIMIT 1',
).bind(customerId, OPERATION_KEY, idempotencyKey).first<IdempotencyRow>();

const replayOrReject = (
  row: IdempotencyRow,
  requestHash: string,
  now: string,
): CreateOrderResult | null => {
  if (!isFiniteIsoDate(row.expires_at) || row.expires_at <= now) return null;
  if (row.request_hash !== requestHash) {
    throw new OrderPersistenceError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
  }
  if (row.state === 'IN_PROGRESS') throw new OrderPersistenceError('IDEMPOTENCY_IN_PROGRESS', 409);
  if (row.state === 'FAILED') throw new OrderPersistenceError('CONFLICT', 409);
  if (row.state !== 'COMPLETED' || !row.response_json ||
      !Number.isInteger(row.response_status) || (row.response_status as number) < 200 ||
      (row.response_status as number) > 299) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  return {
    data: parseStoredOrderData(row.response_json),
    status: row.response_status as number,
    replayed: true,
  };
};

const validatePricing = (
  request: CreateCommerceOrderRequest,
  pricing: AuthoritativelyPricedOrder,
): Readonly<{
  currency: string;
  pricingMode: 'live' | 'demo';
  lines: readonly Readonly<{
    orderLineId: string;
    item: AuthoritativelyPricedOrderItem;
    lineSubtotalMinor: number;
    lineTotalMinor: number;
  }>[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}> => {
  if (!isRecord(pricing) || typeof pricing.currency !== 'string' || !/^[A-Z]{3}$/.test(pricing.currency) ||
      !Array.isArray(pricing.items) || pricing.items.length !== request.items.length ||
      pricing.items.length < 1 || pricing.items.length > 50) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const pricingMode = pricing.pricingMode === undefined ? 'live' : pricing.pricingMode
  if (pricingMode !== 'live' && pricingMode !== 'demo') {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }

  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  let totalMinor = 0;
  const lines = pricing.items.map((item, index) => {
    if (!isRecord(item) ||
        item.itemRef !== request.items[index]?.itemRef ||
        item.quantity !== request.items[index]?.quantity ||
        (item.itemType !== 'CONTENT' && item.itemType !== 'MEMBERSHIP_PLAN' &&
          item.itemType !== 'DIGITAL_GOOD' && item.itemType !== 'BUNDLE') ||
        typeof item.itemVersion !== 'string' || item.itemVersion.length < 1 ||
        item.itemVersion.length > 255 ||
        item.currency !== pricing.currency ||
        typeof item.itemSnapshotJson !== 'string' ||
        new TextEncoder().encode(item.itemSnapshotJson).byteLength > MAX_SNAPSHOT_BYTES ||
        item.quantity < 1 || item.quantity > 10000 || !Number.isSafeInteger(item.quantity)) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(item.itemSnapshotJson) as unknown;
    } catch {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    }
    if (!isRecord(snapshot)) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
    const markerExists = Object.prototype.hasOwnProperty.call(snapshot, 'luckreadPricing')
    const snapshotMode = readSnapshotPricingMode(item.itemSnapshotJson)
    if ((pricingMode === 'demo' && snapshotMode !== 'demo') ||
        (pricingMode === 'live' && markerExists)) {
      throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
    }

    const unit = assertSafeMinor(item.unitAmountMinor, 'unitAmountMinor');
    // PAY-002 currently admits only paid checkout. A zero-priced line cannot
    // rely on the payment flow to establish entitlements; that needs a separate
    // zero-charge fulfillment contract and must fail before order persistence.
    if (unit === 0) throw new OrderPersistenceError('CONFLICT', 409);
    const lineDiscount = assertSafeMinor(item.lineDiscountMinor, 'lineDiscountMinor');
    const lineTax = assertSafeMinor(item.lineTaxMinor, 'lineTaxMinor');
    const lineSubtotal = checkedMultiply(unit, item.quantity);
    if (lineDiscount > lineSubtotal) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    const lineTotal = checkedAdd(lineSubtotal - lineDiscount, lineTax);

    subtotalMinor = checkedAdd(subtotalMinor, lineSubtotal);
    discountMinor = checkedAdd(discountMinor, lineDiscount);
    taxMinor = checkedAdd(taxMinor, lineTax);
    totalMinor = checkedAdd(totalMinor, lineTotal);
    const validatedItem: AuthoritativelyPricedOrderItem = {
      itemType: item.itemType as AuthoritativelyPricedOrderItem['itemType'],
      itemRef: item.itemRef as string,
      itemVersion: item.itemVersion as string,
      quantity: item.quantity as number,
      unitAmountMinor: unit,
      currency: item.currency as string,
      lineDiscountMinor: lineDiscount,
      lineTaxMinor: lineTax,
      itemSnapshotJson: item.itemSnapshotJson as string,
    };
    return {
      orderLineId: '',
      item: validatedItem,
      lineSubtotalMinor: lineSubtotal,
      lineTotalMinor: lineTotal,
    };
  });

  if (totalMinor !== subtotalMinor - discountMinor + taxMinor) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }
  // The existing payment-persistence contract only accepts positive payable
  // orders. Reject 100%-discounted/zero-tax baskets instead of creating an
  // order that cannot proceed through the admitted payment lifecycle.
  if (totalMinor <= 0) throw new OrderPersistenceError('CONFLICT', 409);
  return { currency: pricing.currency, pricingMode, lines, subtotalMinor, discountMinor, taxMinor, totalMinor };
};

export async function createCommerceOrder(
  db: D1Database,
  customerIdInput: string,
  idempotencyKeyInput: string | null | undefined,
  rawRequest: unknown,
  resolvePricing: (request: CreateCommerceOrderRequest) => Promise<AuthoritativelyPricedOrder>,
  dependencies: OrderPersistenceDependencies = {},
): Promise<CreateOrderResult> {
  const customerId = requireIdentifier(customerIdInput, 'customerId');
  const keyResult = validateOrderCreateIdempotencyKey(idempotencyKeyInput);
  if (!keyResult.ok) {
    throw new OrderPersistenceError(keyResult.error.code, keyResult.error.status);
  }
  const key = keyResult.value;
  const validation = validateCreateCommerceOrderRequest(rawRequest);
  if (!validation.ok) {
    throw new OrderPersistenceError(validation.error.code, validation.error.status);
  }
  const request = validation.value;
  const requestHash = await orderRequestHash(request, dependencies.idempotencyContext);
  const nowFn = dependencies.now ?? (() => new Date());
  const nowDate = nowFn();
  if (!Number.isFinite(nowDate.getTime())) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  const now = nowDate.toISOString();

  const existing = await readIdempotencyRow(db, customerId, key);
  if (existing) {
    const replay = replayOrReject(existing, requestHash, now);
    if (replay) return replay;
  }

  // All authoritative lookups/pricing are outside the D1 write transaction:
  // no cross-D1 operation or provider network call occurs inside the batch.
  const pricing = validatePricing(request, await resolvePricing(request));
  const createId = dependencies.createId ?? defaultId;
  const orderId = requireIdentifier(createId('order'), 'orderId', 255);
  const idempotencyId = requireIdentifier(createId('idempotency'), 'idempotencyId', 255);
  const createdAt = now;
  const expiresAt = dependencies.idempotencyExpiresAt ?? new Date(nowDate.getTime() + IDEMPOTENCY_RETENTION_MS).toISOString();
  if (!isFiniteIsoDate(expiresAt) || Date.parse(expiresAt) <= nowDate.getTime()) {
    throw new OrderPersistenceError('VALIDATION_FAILED', 400);
  }

  const lineRecords = pricing.lines.map((line) => ({
    ...line,
    orderLineId: requireIdentifier(createId('line'), 'orderLineId', 255),
  })).sort((a, b) => a.orderLineId.localeCompare(b.orderLineId));

  const publicItems: CommerceOrderLineDto[] = lineRecords.map(({ item, lineSubtotalMinor, lineTotalMinor }) => ({
    itemRef: item.itemRef,
    quantity: item.quantity,
    unitAmountMinor: item.unitAmountMinor,
    lineSubtotalMinor,
    lineDiscountMinor: item.lineDiscountMinor,
    lineTaxMinor: item.lineTaxMinor,
    lineTotalMinor,
  }));

  const data: CommerceOrderData = {
    orderId,
    status: 'CREATED',
    version: 1,
    currency: pricing.currency,
    subtotalMinor: pricing.subtotalMinor,
    discountMinor: pricing.discountMinor,
    taxMinor: pricing.taxMinor,
    totalMinor: pricing.totalMinor,
    items: publicItems,
    createdAt,
    updatedAt: createdAt,
  };
  const responseJson = JSON.stringify(data);
  if (new TextEncoder().encode(responseJson).byteLength > 65_536) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  const statements: D1PreparedStatement[] = [
    db.prepare(
      '/* pay002:expire */ DELETE FROM order_create_idempotency ' +
      'WHERE customer_id = ? AND operation_key = ? AND idempotency_key = ? AND expires_at <= ?',
    ).bind(customerId, OPERATION_KEY, key, now),
    db.prepare(
      '/* pay002:claim */ INSERT INTO order_create_idempotency ' +
      '(id, customer_id, operation_key, idempotency_key, request_hash, state, response_status, response_json, created_at, expires_at) ' +
      "VALUES (?, ?, ?, ?, ?, 'IN_PROGRESS', NULL, NULL, ?, ?) " +
      'ON CONFLICT(customer_id, operation_key, idempotency_key) DO NOTHING',
    ).bind(idempotencyId, customerId, OPERATION_KEY, key, requestHash, createdAt, expiresAt),
    db.prepare(
      '/* pay002:complete */ UPDATE order_create_idempotency ' +
      "SET state = 'COMPLETED', response_status = 201, response_json = ? " +
      "WHERE id = ? AND customer_id = ? AND operation_key = ? AND idempotency_key = ? AND request_hash = ? AND state = 'IN_PROGRESS'",
    ).bind(responseJson, idempotencyId, customerId, OPERATION_KEY, key, requestHash),
    db.prepare(
      '/* pay002:order */ INSERT INTO orders ' +
      '(order_id, customer_id, status, version, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at, confirmed_at, cancelled_at, failure_code) ' +
      "SELECT ?, ?, 'CREATED', 1, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL " +
      "WHERE EXISTS (SELECT 1 FROM order_create_idempotency WHERE id = ? AND customer_id = ? AND operation_key = ? AND idempotency_key = ? AND request_hash = ? AND state = 'COMPLETED' AND response_json = ?)",
    ).bind(
      orderId, customerId, pricing.currency, pricing.subtotalMinor, pricing.discountMinor,
      pricing.taxMinor, pricing.totalMinor, createdAt, createdAt,
      idempotencyId, customerId, OPERATION_KEY, key, requestHash, responseJson,
    ),
    ...lineRecords.map(({ orderLineId, item, lineSubtotalMinor, lineTotalMinor }) =>
      db.prepare(
        '/* pay002:line */ INSERT INTO order_lines ' +
        '(order_line_id, order_id, item_type, item_ref, item_version, quantity, unit_amount_minor, line_subtotal_minor, line_discount_minor, line_tax_minor, line_total_minor, item_snapshot_json, created_at) ' +
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS ' +
        '(SELECT 1 FROM orders WHERE order_id = ? AND customer_id = ?)',
      ).bind(
        orderLineId, orderId, item.itemType, item.itemRef, item.itemVersion, item.quantity,
        item.unitAmountMinor, lineSubtotalMinor, item.lineDiscountMinor, item.lineTaxMinor,
        lineTotalMinor, item.itemSnapshotJson, createdAt, orderId, customerId,
      ),
    ),
  ];

  // D1 batch wraps this ordered set in one transaction. If any insert violates a
  // database constraint, the claim, Order and all OrderLines roll back together.
  const results = await db.batch(statements);
  const claimChanges = Number(results[1]?.meta?.changes ?? 0);
  if (claimChanges !== 1) {
    const raced = await readIdempotencyRow(db, customerId, key);
    if (!raced) throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
    const replay = replayOrReject(raced, requestHash, now);
    if (replay) return replay;
    throw new OrderPersistenceError('IDEMPOTENCY_IN_PROGRESS', 409);
  }

  if (results.length !== statements.length ||
      ![0, 1].includes(Number(results[0]?.meta?.changes ?? 0)) ||
      Number(results[2]?.meta?.changes ?? 0) !== 1 ||
      Number(results[3]?.meta?.changes ?? 0) !== 1 ||
      results.slice(4).some((result) => Number(result?.meta?.changes ?? 0) !== 1)) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500);
  }

  return { data, status: 201, replayed: false };
}

export async function getCommerceOrder(
  db: D1Database,
  customerIdInput: string,
  orderIdInput: string,
): Promise<CommerceOrderData> {
  const customerId = requireIdentifier(customerIdInput, 'customerId');
  const orderId = requireIdentifier(orderIdInput, 'orderId', 255);
  const order = await db.prepare(
    'SELECT order_id, customer_id, status, version, currency, subtotal_minor, discount_minor, tax_minor, total_minor, created_at, updated_at ' +
    'FROM orders WHERE order_id = ? AND customer_id = ? LIMIT 1',
  ).bind(orderId, customerId).first<OrderRow>();
  if (!order) throw new OrderPersistenceError('RESOURCE_NOT_FOUND', 404);

  const result = await db.prepare(
    'SELECT order_line_id, order_id, item_type, item_ref, item_version, quantity, unit_amount_minor, line_subtotal_minor, line_discount_minor, line_tax_minor, line_total_minor, item_snapshot_json, created_at ' +
    'FROM order_lines WHERE order_id = ? ORDER BY order_line_id ASC',
  ).bind(orderId).all<OrderLineRow>();
  const lineModes = (result.results ?? []).map((line) => readSnapshotPricingMode(line.item_snapshot_json))
  const firstLineMode = lineModes[0] ?? 'live'
  if (lineModes.some((mode) => mode !== firstLineMode)) {
    throw new OrderPersistenceError('INTEGRITY_VIOLATION', 500)
  }
  const publicData: unknown = {
    orderId: order.order_id,
    status: order.status,
    version: order.version,
    currency: order.currency,
    subtotalMinor: order.subtotal_minor,
    discountMinor: order.discount_minor,
    taxMinor: order.tax_minor,
    totalMinor: order.total_minor,
    items: (result.results ?? []).map((line) => ({
      itemRef: line.item_ref,
      quantity: line.quantity,
      unitAmountMinor: line.unit_amount_minor,
      lineSubtotalMinor: line.line_subtotal_minor,
      lineDiscountMinor: line.line_discount_minor,
      lineTaxMinor: line.line_tax_minor,
      lineTotalMinor: line.line_total_minor,
    })),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
  return parseStoredOrderData(JSON.stringify(publicData));
}
