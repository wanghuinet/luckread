/// <reference types="@cloudflare/workers-types" />

import {
  deleteHyperswitchPaymentMethod,
  listHyperswitchCustomerPaymentMethods,
  retrieveHyperswitchMandate,
  revokeHyperswitchMandate,
  HyperswitchClientError,
  type HyperswitchClientConfig,
} from './hyperswitch-client.js';
import {
  createPaymentMethodRevocationRequest,
  getSavedPaymentMethodMandates,
  listSavedPaymentMethodRecords,
  markPaymentMethodProviderDeleted,
  PaymentMethodPersistenceError,
  type PaymentMethodRevocationRequest,
  type SavedPaymentMethodRecord,
} from './payment-method-persistence.js';

export type PaymentMethodRuntimeEnv = Readonly<{
  D1_04: D1Database;
  HYPERSWITCH_ENVIRONMENT?: string | null;
  HYPERSWITCH_API_KEY?: string | null;
  HYPERSWITCH_MERCHANT_ID?: string | null;
}>;

export class PaymentMethodRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = 'PaymentMethodRuntimeError';
  }
}

const safeText = (value: unknown, maxLength: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= maxLength &&
  value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

function resolveHyperswitchConfig(env: PaymentMethodRuntimeEnv): HyperswitchClientConfig {
  if (
    (env.HYPERSWITCH_ENVIRONMENT !== 'sandbox' && env.HYPERSWITCH_ENVIRONMENT !== 'production') ||
    !safeText(env.HYPERSWITCH_API_KEY, 4096) ||
    /[\r\n]/.test(env.HYPERSWITCH_API_KEY) ||
    !safeText(env.HYPERSWITCH_MERCHANT_ID, 256)
  ) throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
  return {
    environment: env.HYPERSWITCH_ENVIRONMENT,
    apiKey: env.HYPERSWITCH_API_KEY,
    expectedMerchantId: env.HYPERSWITCH_MERCHANT_ID,
  };
}

function mapPersistenceError(error: PaymentMethodPersistenceError): PaymentMethodRuntimeError {
  return new PaymentMethodRuntimeError(error.code, error.status);
}

function mapProviderError(error: unknown): PaymentMethodRuntimeError {
  if (error instanceof HyperswitchClientError) {
    if (error.code === 'REQUEST_INVALID') return new PaymentMethodRuntimeError('VALIDATION_FAILED', 400);
    if (error.code === 'UPSTREAM_REJECTED' && error.upstreamStatus === 404) {
      return new PaymentMethodRuntimeError('PROVIDER_RESOURCE_NOT_FOUND', 404);
    }
  }
  return new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
}

export type SavedPaymentMethodDto = Readonly<{
  savedPaymentMethodId: string;
  paymentMethod: string;
  paymentMethodType: string | null;
  brand: string | null;
  last4: string | null;
  expiryMonth: string | null;
  expiryYear: string | null;
  createdAt: string;
  recurringEnabled: boolean;
  mandateStatus: SavedPaymentMethodRecord['mandateStatus'];
  status: 'ACTIVE' | 'SETUP_PENDING' | 'NO_RECURRING' | 'REVOCATION_PENDING';
}>;

function toSavedPaymentMethodDto(
  local: SavedPaymentMethodRecord,
  provider: Awaited<ReturnType<typeof listHyperswitchCustomerPaymentMethods>>[number] | undefined,
): SavedPaymentMethodDto {
  const pending = local.revocationStatus !== null && local.revocationStatus !== 'COMPLETED';
  return {
    savedPaymentMethodId: local.savedPaymentMethodId,
    paymentMethod: provider?.paymentMethod ?? 'saved_payment_method',
    paymentMethodType: provider?.paymentMethodType ?? null,
    brand: provider?.brand ?? null,
    last4: provider?.last4 ?? null,
    expiryMonth: provider?.expiryMonth ?? null,
    expiryYear: provider?.expiryYear ?? null,
    createdAt: local.createdAt,
    recurringEnabled: provider?.recurringEnabled ?? false,
    mandateStatus: local.mandateStatus,
    status: pending
      ? 'REVOCATION_PENDING'
      : local.mandateStatus === 'ACTIVE'
        ? 'ACTIVE'
        : local.mandateStatus === 'PENDING_PROVIDER_CONFIRMATION'
          ? 'SETUP_PENDING'
          : 'NO_RECURRING',
  };
}

/** Read saved methods only after intersecting provider output with webhook-verified D1-04 ownership records. */
export async function listOwnedSavedPaymentMethods(
  env: PaymentMethodRuntimeEnv,
  customerId: string,
): Promise<readonly SavedPaymentMethodDto[]> {
  const config = resolveHyperswitchConfig(env);
  let local: readonly SavedPaymentMethodRecord[];
  try {
    local = await listSavedPaymentMethodRecords(env.D1_04, customerId, String(config.expectedMerchantId));
  } catch (error) {
    if (error instanceof PaymentMethodPersistenceError) throw mapPersistenceError(error);
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  if (local.length === 0) return [];
  let providerMethods: Awaited<ReturnType<typeof listHyperswitchCustomerPaymentMethods>>;
  try {
    providerMethods = await listHyperswitchCustomerPaymentMethods(config, customerId);
  } catch (error) {
    throw mapProviderError(error);
  }
  const providerById = new Map(providerMethods.map((item) => [item.paymentMethodId, item]));
  // Strict provider/local intersection: only a currently vaulted provider method
  // is surfaced, except a locally blocked revocation that still awaits signed
  // mandate-webhook finalization after the provider has removed the vault item.
  return local
    .filter((item) =>
      providerById.has(item.paymentMethodId) ||
      (item.revocationStatus !== null && item.revocationStatus !== 'COMPLETED')
    )
    .map((item) => toSavedPaymentMethodDto(item, providerById.get(item.paymentMethodId)));
}

function nowIso(): string {
  return new Date().toISOString();
}

async function confirmProviderMandateRevoked(
  config: HyperswitchClientConfig,
  mandateId: string,
): Promise<boolean> {
  try {
    await revokeHyperswitchMandate(config, mandateId);
    return true;
  } catch (revokeError) {
    // A timeout/409 may mean the provider already processed the original revoke.
    // Read the provider's authoritative mandate status; never mutate local D1 from it.
    try {
      const current = await retrieveHyperswitchMandate(config, mandateId);
      return current.status === 'revoked';
    } catch {
      if (revokeError instanceof HyperswitchClientError &&
          revokeError.code === 'UPSTREAM_REJECTED' &&
          revokeError.upstreamStatus === 404) {
        return false;
      }
      return false;
    }
  }
}

/**
 * Start provider revocation for every mandate attached to this saved method,
 * then delete the provider vault reference. D1-04's request row blocks new MIT
 * charges immediately. Local mandate states are finalized only by signed
 * mandate_revoked webhooks.
 */
export async function revokeOwnedSavedPaymentMethod(
  env: PaymentMethodRuntimeEnv,
  customerId: string,
  savedPaymentMethodId: string,
  idempotencyKey: string | null,
): Promise<Readonly<{ savedPaymentMethodId: string; status: 'REVOCATION_PENDING' | 'REMOVED'; replayed: boolean }>> {
  const config = resolveHyperswitchConfig(env);
  const key = idempotencyKey?.trim() ?? '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key) || key !== idempotencyKey) {
    throw new PaymentMethodRuntimeError(key ? 'VALIDATION_FAILED' : 'PRECONDITION_REQUIRED', key ? 400 : 428);
  }

  let started: Awaited<ReturnType<typeof createPaymentMethodRevocationRequest>>;
  try {
    started = await createPaymentMethodRevocationRequest(
      env.D1_04,
      customerId,
      String(config.expectedMerchantId),
      savedPaymentMethodId,
      key,
      nowIso(),
    );
  } catch (error) {
    if (error instanceof PaymentMethodPersistenceError) throw mapPersistenceError(error);
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
  const request = started.request;
  if (request.status === 'COMPLETED') {
    return { savedPaymentMethodId, status: 'REMOVED', replayed: true };
  }

  // First DELETE invocation spends its single D1-04 write on the durable MIT
  // block. The client repeats the same idempotent DELETE to dispatch provider
  // revocation and use that second request's one D1-04 write for final state.
  if (!started.dispatchProvider) {
    return { savedPaymentMethodId, status: 'REVOCATION_PENDING', replayed: started.replayed };
  }

  let mandates: Awaited<ReturnType<typeof getSavedPaymentMethodMandates>>;
  try {
    mandates = await getSavedPaymentMethodMandates(
      env.D1_04, customerId, String(config.expectedMerchantId), savedPaymentMethodId,
    );
  } catch (error) {
    if (error instanceof PaymentMethodPersistenceError) throw mapPersistenceError(error);
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
  }

  // A setup webhook can arrive after this request. Without a provider mandate
  // ID, keep the request blocking MIT and wait for the signed provider event.
  if (mandates.some((mandate) =>
    mandate.status === 'PENDING_PROVIDER_CONFIRMATION' && mandate.providerMandateId === null
  )) {
    return { savedPaymentMethodId, status: 'REVOCATION_PENDING', replayed: started.replayed };
  }

  for (const mandate of mandates) {
    if (['REVOKED', 'FAILED', 'EXPIRED'].includes(mandate.status)) continue;
    if (!mandate.providerMandateId) {
      return { savedPaymentMethodId, status: 'REVOCATION_PENDING', replayed: started.replayed };
    }
    const revoked = await confirmProviderMandateRevoked(config, mandate.providerMandateId);
    if (!revoked) {
      return { savedPaymentMethodId, status: 'REVOCATION_PENDING', replayed: started.replayed };
    }
  }

  try {
    await deleteHyperswitchPaymentMethod(config, request.paymentMethodId);
  } catch (error) {
    // DELETE is idempotent: an already absent provider vault reference is
    // acceptable, but provider uncertainty leaves the durable MIT block in place.
    if (!(error instanceof HyperswitchClientError) ||
        !(error.code === 'UPSTREAM_REJECTED' && error.upstreamStatus === 404)) {
      return { savedPaymentMethodId, status: 'REVOCATION_PENDING', replayed: started.replayed };
    }
  }

  // The persistence update derives finality inside its D1-04 CAS statement.
  // This avoids racing a just-arrived signed mandate_revoked webhook.
  try {
    const updated = await markPaymentMethodProviderDeleted(
      env.D1_04, request, nowIso(),
    );
    return {
      savedPaymentMethodId,
      status: updated.status === 'COMPLETED' ? 'REMOVED' : 'REVOCATION_PENDING',
      replayed: started.replayed,
    };
  } catch (error) {
    if (error instanceof PaymentMethodPersistenceError) throw mapPersistenceError(error);
    throw new PaymentMethodRuntimeError('SERVICE_UNAVAILABLE', 503);
  }
}
