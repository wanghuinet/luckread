import {
  createCommerceOrder,
  OrderPersistenceError,
  type CreateOrderResult,
  type CommerceOrderData,
  type AuthoritativelyPricedOrder,
  type OrderCreatePersistenceStore,
} from './order-persistence.js';
import { SubscriptionRuntimeError } from './subscription-runtime.js';
import { validateCreateCommerceOrderRequest, validateOrderCreateIdempotencyKey } from './order-request-validation.js';
import { issueInvoiceForOrderPostgres } from './billing-document-postgres-persistence.js';
import { getCommerceOrderPostgres } from './order-read-postgres.js';
import {
  getW07OrderCreatePersistenceStore,
  getW07PaymentWebhookPostgresPool,
  type W07PaymentMethodReadRuntimeEnv,
} from './neon/payment-method-read-runtime.js';
import type { W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

type OrderRuntimeEnv = Omit<W07PaymentMethodReadRuntimeEnv, 'D1_04'>;

type OrderRuntimeDependencies = Readonly<{
  createOrder?: typeof createCommerceOrder;
  getOrder?: typeof getCommerceOrderPostgres;
  issueInvoice?: typeof issueInvoiceForOrderPostgres;
  getPostgresPool?: (env: OrderRuntimeEnv) => W07WebhookPostgresPool | undefined;
  getOrderCreateStore?: (env: OrderRuntimeEnv) => OrderCreatePersistenceStore | undefined;
  /** Must be an admitted pricing authority that returns immutable offer versions, discounts, and tax decisions. */
  resolvePricing?: (request: unknown) => Promise<AuthoritativelyPricedOrder>;
}>;

type OrderRoute =
  | { operation: 'create'; orderId: null }
  | { operation: 'get'; orderId: string };

const MAX_ORDER_BODY_BYTES = 16_384;

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: {} }, requestId: 'req_' + crypto.randomUUID() },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

function resolveRoute(request: Request): OrderRoute | Response | null {
  let segments: string[];
  try {
    segments = new URL(request.url).pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'Invalid order path');
  }

  if (segments[0] !== 'commerce' || segments[1] !== 'orders') return null;
  if (request.method === 'POST' && segments.length === 2) {
    return { operation: 'create', orderId: null };
  }
  if (request.method === 'GET' && segments.length === 3 && segments[2]!.length > 0) {
    return { operation: 'get', orderId: segments[2]! };
  }
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}

async function readBoundedJson(request: Request): Promise<unknown | Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return errorResponse(400, 'VALIDATION_FAILED', 'A JSON order body is required');
  }
  const declaredLengthHeader = request.headers.get('content-length');
  if (declaredLengthHeader !== null) {
    if (!/^\d+$/.test(declaredLengthHeader) || Number(declaredLengthHeader) > MAX_ORDER_BODY_BYTES) {
      return errorResponse(400, 'VALIDATION_FAILED', 'Order request is too large or malformed');
    }
  }
  if (!request.body) return errorResponse(400, 'VALIDATION_FAILED', 'A JSON order body is required');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > MAX_ORDER_BODY_BYTES) {
        await reader.cancel();
        return errorResponse(400, 'VALIDATION_FAILED', 'Order request is too large');
      }
      chunks.push(part.value);
    }
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON order body is required');
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return errorResponse(400, 'VALIDATION_FAILED', 'A valid JSON order body is required');
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

function mapOrderError(error: OrderPersistenceError | SubscriptionRuntimeError): Response {
  if (error instanceof OrderPersistenceError) {
    const message =
      error.code === 'RESOURCE_NOT_FOUND' ? 'Order not found' :
      error.code === 'PRECONDITION_REQUIRED' ? 'Idempotency-Key is required' :
      error.code === 'IDEMPOTENCY_KEY_REUSE_CONFLICT' ? 'Idempotency-Key was used for a different request' :
      error.code === 'IDEMPOTENCY_IN_PROGRESS' ? 'An order request with this key is still in progress' :
      error.code === 'CONFLICT' ? 'Order request conflicts with the current state' :
      error.code === 'VALIDATION_FAILED' ? 'Order request validation failed' :
      error.code === 'INTEGRITY_VIOLATION' ? 'Order persistence integrity check failed' :
      'Order service unavailable';
    return errorResponse(error.status, error.code, message);
  }

  const message =
    error.code === 'RESOURCE_NOT_FOUND' ? 'Purchasable offer not found' :
    error.code === 'VALIDATION_FAILED' ? 'Order request validation failed' :
    error.code === 'PERMISSION_DENIED' ? 'Permission denied' :
    'Order service unavailable';
  return errorResponse(error.status, error.code, message);
}

/**
 * Internal W01 -> W07 order handler. W01 must authenticate, authorize order.create /
 * order.read, and derive the customer principal before calling this handler. W07
 * binds ownership again in native PostgreSQL queries against the separate D1-04
 * finance domain and never accepts customer/provider fields from the body. The
 * route is private to the existing W07_SUBSCRIPTION service binding.
 */
export async function handleCommerceOrderRequest(
  request: Request,
  customerId: string,
  env: OrderRuntimeEnv,
  dependencies: OrderRuntimeDependencies = {},
): Promise<Response | null> {
  const route = resolveRoute(request);
  if (route === null) return null;
  if (isResponse(route)) return route;

  try {
    if (route.operation === 'create') {
      const body = await readBoundedJson(request);
      if (isResponse(body)) return body;

      const requestValidation = validateCreateCommerceOrderRequest(body);
      if (!requestValidation.ok) {
        return errorResponse(
          requestValidation.error.status,
          requestValidation.error.code,
          'Order request validation failed',
        );
      }
      const keyValidation = validateOrderCreateIdempotencyKey(request.headers.get('Idempotency-Key'));
      if (!keyValidation.ok) {
        const message = keyValidation.error.code === 'PRECONDITION_REQUIRED'
          ? 'Idempotency-Key is required'
          : 'Idempotency-Key is invalid';
        return errorResponse(keyValidation.error.status, keyValidation.error.code, message);
      }

      // No admitted discount/tax assessment integration is wired into the production
      // handler yet. Never silently synthesize zero discount or zero tax, even
      // though the generic persistence helper requires those explicit decisions.
      if (!dependencies.resolvePricing) {
        return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Order creation is disabled until the authoritative pricing and tax decision is admitted');
      }

      const orderCreateStore = (dependencies.getOrderCreateStore ?? getW07OrderCreatePersistenceStore)(env);
      const pool = (dependencies.getPostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
      if (!orderCreateStore || !pool) {
        throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
      }
      const createOrder = dependencies.createOrder ?? createCommerceOrder;
      const result: CreateOrderResult = await createOrder(
        orderCreateStore,
        customerId,
        request.headers.get('Idempotency-Key'),
        body,
        (validatedRequest) => dependencies.resolvePricing!(validatedRequest),
      );
      // Invoice issuance is replay-safe on (INVOICE, order_id) and runs in the
      // same D1-04 Neon finance domain as the Order, never through a D1 facade.
      const issueInvoice = dependencies.issueInvoice ?? issueInvoiceForOrderPostgres;
      await issueInvoice(pool, customerId, result.data.orderId);
      return Response.json(
        { data: result.data, requestId: 'req_' + crypto.randomUUID() },
        { status: result.status, headers: { 'cache-control': 'no-store' } },
      );
    }

    // Order detail is read-only and is owner-scoped within the D1-04 Neon
    // finance database. The native reader uses a repeatable-read snapshot.
    const pool = (dependencies.getPostgresPool ?? getW07PaymentWebhookPostgresPool)(env);
    if (!pool) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    const getOrder = dependencies.getOrder ?? getCommerceOrderPostgres;
    const order: CommerceOrderData = await getOrder(pool, customerId, route.orderId);
    return Response.json(
      { data: order, requestId: 'req_' + crypto.randomUUID() },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof OrderPersistenceError || error instanceof SubscriptionRuntimeError) {
      return mapOrderError(error);
    }
    // Never expose database details or turn missing Neon schema into a successful
    // order response.
    console.error('W07 internal order operation failed', error);
    return errorResponse(503, 'SERVICE_UNAVAILABLE', 'Order service unavailable');
  }
}
