import { SubscriptionRuntimeError, validatePrincipal, validateIdempotencyKey } from './subscription-runtime.js';
import type { W07WebhookPostgresClient, W07WebhookPostgresPool } from './payment-webhook-database-postgres.js';

export type FoundingReservationState = 'HELD' | 'COMMITTED' | 'RELEASED' | 'EXPIRED';
export type FoundingReservation = Readonly<{
  reservationId: string;
  planId: string;
  planVersion: number;
  subscriberId: string;
  orderReference: string | null;
  state: FoundingReservationState;
  expiresAt: string;
  replayed: boolean;
}>;

type ReservationRow = Record<string, unknown> & {
  reservation_id: string;
  plan_id: string;
  plan_version: number;
  subscriber_id: string;
  order_reference: string | null;
  state: FoundingReservationState;
  expires_at: string;
};

const MAX_RESERVATION_TTL_MS = 15 * 60 * 1000;
const toPublic = (row: ReservationRow, replayed = false): FoundingReservation => ({
  reservationId: row.reservation_id,
  planId: row.plan_id,
  planVersion: row.plan_version,
  subscriberId: row.subscriber_id,
  orderReference: row.order_reference,
  state: row.state,
  expiresAt: new Date(row.expires_at).toISOString(),
  replayed,
});

const withTransaction = async <T>(
  db: W07WebhookPostgresPool,
  work: (client: W07WebhookPostgresClient) => Promise<T>,
): Promise<T> => {
  const client = await db.connect();
  let began = false;
  try {
    await client.query('BEGIN');
    began = true;
    const result = await work(client);
    await client.query('COMMIT');
    began = false;
    return result;
  } catch (error) {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof SubscriptionRuntimeError) throw error;
    throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
  } finally {
    client.release();
  }
};

const requirePlanId = (value: string): string => {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  return normalized;
};

const requireReservation = async (
  client: W07WebhookPostgresClient,
  reservationId: string,
): Promise<ReservationRow> => {
  const result = await client.query<ReservationRow>(
    'SELECT reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
    "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at " +
    'FROM membership_founding_reservations WHERE reservation_id = $1 FOR UPDATE',
    [reservationId],
  );
  const row = result.rows[0];
  if (!row) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);
  return row;
};

/**
 * Holds one founding seat. Locking the parent plan row serializes all attempts
 * for that offer; the count is read from authoritative reservation rows, never
 * from cache or analytics. Capacity is checked across every plan version.
 */
export async function reserveFoundingOfferCapacity(
  db: W07WebhookPostgresPool,
  input: Readonly<{
    planId: string;
    planVersion: number;
    subscriberId: string;
    idempotencyKey: string;
    now?: Date;
    ttlMs?: number;
  }>,
): Promise<FoundingReservation> {
  const planId = requirePlanId(input.planId);
  const subscriberId = validatePrincipal(input.subscriberId);
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? MAX_RESERVATION_TTL_MS;
  if (!Number.isSafeInteger(input.planVersion) || input.planVersion < 1 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 30_000 || ttlMs > MAX_RESERVATION_TTL_MS) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

  return withTransaction(db, async (client) => {
    const planLock = await client.query<{ plan_id: string }>(
      'SELECT plan_id FROM membership_plans WHERE plan_id = $1 FOR UPDATE',
      [planId],
    );
    if (!planLock.rows[0]) throw new SubscriptionRuntimeError('RESOURCE_NOT_FOUND', 404);

    const existing = await client.query<ReservationRow>(
      'SELECT reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at " +
      'FROM membership_founding_reservations WHERE subscriber_id = $1 AND idempotency_key = $2 FOR UPDATE',
      [subscriberId, idempotencyKey],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      if (row.plan_id !== planId || row.plan_version !== input.planVersion) {
        throw new SubscriptionRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
      }
      return toPublic(row, true);
    }

    const offer = await client.query<Record<string, unknown> & {
      current_version: number; offer_kind: string; founding_capacity: number | null;
      min_capacity: number | null; max_capacity: number | null;
    }>(
      'SELECT p.current_version, v.offer_kind, v.founding_capacity, ' +
      '(SELECT MIN(founding_capacity) FROM membership_plan_versions WHERE plan_id = p.plan_id AND offer_kind = \'FOUNDING\') AS min_capacity, ' +
      '(SELECT MAX(founding_capacity) FROM membership_plan_versions WHERE plan_id = p.plan_id AND offer_kind = \'FOUNDING\') AS max_capacity ' +
      'FROM membership_plans p INNER JOIN membership_plan_versions v ' +
      'ON v.plan_id = p.plan_id AND v.plan_version = $2 WHERE p.plan_id = $1 FOR UPDATE OF p',
      [planId, input.planVersion],
    );
    const offerRow = offer.rows[0];
    if (!offerRow || offerRow.current_version !== input.planVersion || offerRow.offer_kind !== 'FOUNDING' ||
        !Number.isSafeInteger(offerRow.founding_capacity) || (offerRow.founding_capacity as number) < 1 ||
        offerRow.min_capacity !== offerRow.max_capacity) {
      throw new SubscriptionRuntimeError('INVALID_STATE', 409);
    }

    await client.query(
      "UPDATE membership_founding_reservations SET state = 'EXPIRED', updated_at = $2, released_at = $2, release_reason = 'HOLD_EXPIRED' " +
      "WHERE plan_id = $1 AND state = 'HELD' AND expires_at <= $2",
      [planId, now.toISOString()],
    );
    const usage = await client.query<{ occupied: number }>(
      "SELECT COUNT(*)::integer AS occupied FROM membership_founding_reservations " +
      "WHERE plan_id = $1 AND (state = 'COMMITTED' OR (state = 'HELD' AND expires_at > $2))",
      [planId, now.toISOString()],
    );
    if ((usage.rows[0]?.occupied ?? 0) >= (offerRow.founding_capacity as number)) {
      throw new SubscriptionRuntimeError('FOUNDING_CAPACITY_EXHAUSTED', 409);
    }

    const reservationId = 'fres_' + crypto.randomUUID().replaceAll('-', '');
    const inserted = await client.query<ReservationRow>(
      'INSERT INTO membership_founding_reservations ' +
      '(reservation_id, plan_id, plan_version, subscriber_id, idempotency_key, state, expires_at, created_at, updated_at) ' +
      "VALUES ($1, $2, $3, $4, $5, 'HELD', $6, $7, $7) " +
      'RETURNING reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at",
      [reservationId, planId, input.planVersion, subscriberId, idempotencyKey, expiresAt, now.toISOString()],
    );
    const row = inserted.rows[0];
    if (!row) throw new SubscriptionRuntimeError('SERVICE_UNAVAILABLE', 503);
    return toPublic(row);
  });
}

/** Attach the D1-04 order reference after order creation; no cross-DB FK/transaction. */
export async function attachFoundingReservationOrder(
  db: W07WebhookPostgresPool,
  reservationId: string,
  orderReference: string,
): Promise<FoundingReservation> {
  const orderId = requirePlanId(orderReference);
  return withTransaction(db, async (client) => {
    const row = await requireReservation(client, reservationId);
    if (row.state !== 'HELD') throw new SubscriptionRuntimeError('INVALID_STATE', 409);
    if (row.order_reference && row.order_reference !== orderId) {
      throw new SubscriptionRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
    }
    const updated = await client.query<ReservationRow>(
      'UPDATE membership_founding_reservations SET order_reference = $2, updated_at = NOW() ' +
      'WHERE reservation_id = $1 AND state = \'HELD\' AND (order_reference IS NULL OR order_reference = $2) ' +
      'RETURNING reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at",
      [reservationId, orderId],
    );
    const next = updated.rows[0];
    if (!next) throw new SubscriptionRuntimeError('CONFLICT', 409);
    return toPublic(next);
  });
}

/** Called only after W07 has verified the provider payment event/signature. */
export async function commitFoundingReservationAfterVerifiedPayment(
  db: W07WebhookPostgresPool,
  reservationId: string,
  verifiedPaymentEventId: string,
  now = new Date(),
  verifiedPaidAt = now,
): Promise<FoundingReservation> {
  const eventId = requirePlanId(verifiedPaymentEventId);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) ||
      !(verifiedPaidAt instanceof Date) || !Number.isFinite(verifiedPaidAt.getTime())) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  return withTransaction(db, async (client) => {
    const row = await requireReservation(client, reservationId);
    if (row.state === 'COMMITTED') {
      const priorEvent = await client.query<{ provider_event_reference: string }>(
        'SELECT provider_event_reference FROM membership_founding_reservation_payment_events WHERE reservation_id = $1',
        [reservationId],
      );
      if (priorEvent.rows[0]?.provider_event_reference !== eventId) {
        throw new SubscriptionRuntimeError('IDEMPOTENCY_KEY_REUSE_CONFLICT', 409);
      }
      return toPublic(row, true);
    }
    // Webhook delivery can be delayed. Seat eligibility is determined by the
    // finance-authoritative payment confirmation time, not webhook arrival time.
    if (row.state !== 'HELD' || !row.order_reference ||
        Date.parse(row.expires_at) <= verifiedPaidAt.getTime()) {
      throw new SubscriptionRuntimeError('INVALID_STATE', 409);
    }
    const updated = await client.query<ReservationRow>(
      "UPDATE membership_founding_reservations SET state = 'COMMITTED', committed_at = $2, updated_at = $2 " +
      "WHERE reservation_id = $1 AND state = 'HELD' AND expires_at > $2 " +
      'RETURNING reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at",
      [reservationId, now.toISOString()],
    );
    const next = updated.rows[0];
    if (!next) throw new SubscriptionRuntimeError('INVALID_STATE', 409);
    await client.query(
      'INSERT INTO membership_founding_reservation_payment_events (reservation_id, provider_event_reference, created_at) ' +
      'VALUES ($1, $2, $3) ON CONFLICT (reservation_id) DO NOTHING',
      [reservationId, eventId, now.toISOString()],
    );
    return toPublic(next);
  });
}

/** Releases only unpaid HELD reservations. A committed seat is never implicitly restored. */
export async function releaseUnpaidFoundingReservation(
  db: W07WebhookPostgresPool,
  reservationId: string,
  reason: 'ORDER_CREATE_FAILED' | 'PAYMENT_FAILED' | 'HOLD_EXPIRED',
): Promise<FoundingReservation> {
  return withTransaction(db, async (client) => {
    const row = await requireReservation(client, reservationId);
    if (row.state === 'RELEASED' || row.state === 'EXPIRED') return toPublic(row, true);
    if (row.state === 'COMMITTED') throw new SubscriptionRuntimeError('INVALID_STATE', 409);
    const nextState = reason === 'HOLD_EXPIRED' ? 'EXPIRED' : 'RELEASED';
    const updated = await client.query<ReservationRow>(
      'UPDATE membership_founding_reservations SET state = $2, released_at = NOW(), updated_at = NOW(), release_reason = $3 ' +
      "WHERE reservation_id = $1 AND state = 'HELD' " +
      'RETURNING reservation_id, plan_id, plan_version, subscriber_id, order_reference, state, ' +
      "to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS expires_at",
      [reservationId, nextState, reason],
    );
    const next = updated.rows[0];
    if (!next) throw new SubscriptionRuntimeError('CONFLICT', 409);
    return toPublic(next);
  });
}


/** Commit the reservation associated with an already verified and durably applied paid order. */
export async function commitFoundingReservationForPaidOrder(
  db: W07WebhookPostgresPool,
  orderReference: string,
  verifiedPaymentEventId: string,
  now = new Date(),
  verifiedPaidAt = now,
): Promise<FoundingReservation | null> {
  const orderId = requirePlanId(orderReference);
  const selected = await db.query<{ reservation_id: string }>(
    "SELECT reservation_id FROM membership_founding_reservations WHERE order_reference = $1 LIMIT 1",
    [orderId],
  );
  const reservationId = selected.rows[0]?.reservation_id;
  if (!reservationId) return null;
  return commitFoundingReservationAfterVerifiedPayment(db, reservationId, verifiedPaymentEventId, now, verifiedPaidAt);
}


/**
 * Resolve the paid order from the finance authority, then commit its membership-DB
 * reservation. The databases intentionally remain separate; the webhook retry is
 * the saga recovery mechanism if the second step is interrupted.
 */
export async function commitFoundingReservationForVerifiedPayment(
  membershipDb: W07WebhookPostgresPool,
  financeDb: W07WebhookPostgresPool,
  paymentId: string,
  merchantId: string,
  verifiedPaymentEventId: string,
  now = new Date(),
): Promise<FoundingReservation | null> {
  if (!/^pay_[A-Za-z0-9]{26}$/.test(paymentId) || !merchantId || merchantId.length > 256) {
    throw new SubscriptionRuntimeError('VALIDATION_FAILED', 400);
  }
  const paidOrder = await financeDb.query<{ order_id: string; confirmed_at: string }>(
    "SELECT p.order_id, o.confirmed_at::text AS confirmed_at " +
    "FROM payments p INNER JOIN orders o ON o.order_id = p.order_id " +
    "AND o.customer_id = p.customer_id WHERE p.payment_id = $1 AND p.merchant_id = $2 " +
    "AND p.provider = 'hyperswitch' AND p.status = 'succeeded' AND o.status IN ('CONFIRMED', 'COMPLETED') LIMIT 1",
    [paymentId, merchantId],
  );
  const order = paidOrder.rows[0];
  if (!order?.order_id || !order.confirmed_at || !Number.isFinite(Date.parse(order.confirmed_at))) {
    throw new SubscriptionRuntimeError('INVALID_STATE', 409);
  }
  return commitFoundingReservationForPaidOrder(
    membershipDb, order.order_id, verifiedPaymentEventId, now, new Date(order.confirmed_at),
  );
}
