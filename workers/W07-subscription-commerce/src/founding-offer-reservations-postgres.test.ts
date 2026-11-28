import { describe, expect, it } from 'vitest';
import type {
  W07WebhookPostgresClient,
  W07WebhookPostgresPool,
  W07WebhookPostgresQueryResult,
} from './payment-webhook-database-postgres.js';
import {
  commitFoundingReservationAfterVerifiedPayment,
  reserveFoundingOfferCapacity,
} from './founding-offer-reservations-postgres.js';

type Row = Record<string, unknown>;
class FakeClient implements W07WebhookPostgresClient {
  readonly statements: Array<{ sql: string; values: unknown[] }> = [];
  constructor(private readonly answer: (sql: string, values: unknown[]) => Row[]) {}
  async query<T extends Row = Row>(sql: string, values: unknown[] = []): Promise<W07WebhookPostgresQueryResult<T>> {
    this.statements.push({ sql, values });
    const rows = this.answer(sql, values) as T[];
    return { rows, rowCount: rows.length };
  }
  release(): void {}
}
const poolFor = (client: FakeClient): W07WebhookPostgresPool => ({
  async query<T extends Row = Row>(): Promise<W07WebhookPostgresQueryResult<T>> {
    throw new Error('unexpected pool query; transaction client required');
  },
  async connect() { return client; },
});
const heldRow = {
  reservation_id: 'fres_0123456789abcdef',
  plan_id: 'plan_founder',
  plan_version: 1,
  subscriber_id: 'subscriber_1',
  order_reference: null,
  state: 'HELD',
  expires_at: '2026-11-29T12:15:00.000Z',
};

describe('founding offer capacity reservation', () => {
  it('serializes by parent plan before checking authoritative reservation usage', async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('SELECT plan_id FROM membership_plans')) return [{ plan_id: 'plan_founder' }];
      if (sql.includes('FROM membership_founding_reservations WHERE subscriber_id')) return [];
      if (sql.includes('SELECT p.current_version')) return [{
        current_version: 1, offer_kind: 'FOUNDING', founding_capacity: 1, min_capacity: 1, max_capacity: 1,
      }];
      if (sql.includes('COUNT(*)::integer AS occupied')) return [{ occupied: 0 }];
      if (sql.includes('INSERT INTO membership_founding_reservations')) return [heldRow];
      return [];
    });
    const result = await reserveFoundingOfferCapacity(poolFor(client), {
      planId: 'plan_founder', planVersion: 1, subscriberId: 'subscriber_1',
      idempotencyKey: 'reserve-1', now: new Date('2026-11-29T12:00:00.000Z'),
    });
    const lockIndex = client.statements.findIndex((entry) => entry.sql.includes('SELECT plan_id FROM membership_plans'));
    const countIndex = client.statements.findIndex((entry) => entry.sql.includes('COUNT(*)::integer AS occupied'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(result.state).toBe('HELD');
    expect(result.replayed).toBe(false);
    expect(client.statements.some((entry) => entry.sql === 'COMMIT')).toBe(true);
  });

  it('rejects a reservation when committed seats plus live holds reach capacity', async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('SELECT plan_id FROM membership_plans')) return [{ plan_id: 'plan_founder' }];
      if (sql.includes('WHERE subscriber_id = $1 AND idempotency_key = $2')) return [];
      if (sql.includes('SELECT p.current_version')) return [{
        current_version: 1, offer_kind: 'FOUNDING', founding_capacity: 1, min_capacity: 1, max_capacity: 1,
      }];
      if (sql.includes('COUNT(*)::integer AS occupied')) return [{ occupied: 1 }];
      return [];
    });
    await expect(reserveFoundingOfferCapacity(poolFor(client), {
      planId: 'plan_founder', planVersion: 1, subscriberId: 'subscriber_2',
      idempotencyKey: 'reserve-2', now: new Date('2026-11-29T12:00:00.000Z'),
    })).rejects.toMatchObject({ code: 'FOUNDING_CAPACITY_EXHAUSTED', status: 409 });
    expect(client.statements.some((entry) => entry.sql.includes('INSERT INTO membership_founding_reservations'))).toBe(false);
    expect(client.statements.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
  });

  it('replays the same idempotency identity without consuming another seat', async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('SELECT plan_id FROM membership_plans')) return [{ plan_id: 'plan_founder' }];
      if (sql.includes('WHERE subscriber_id = $1 AND idempotency_key = $2')) return [heldRow];
      return [];
    });
    const result = await reserveFoundingOfferCapacity(poolFor(client), {
      planId: 'plan_founder', planVersion: 1, subscriberId: 'subscriber_1',
      idempotencyKey: 'reserve-1',
    });
    expect(result.replayed).toBe(true);
    expect(client.statements.some((entry) => entry.sql.includes('COUNT(*)::integer AS occupied'))).toBe(false);
  });

  it('commits a seat using finance payment time even when webhook delivery is delayed', async () => {
    const committed = { ...heldRow, order_reference: 'ord_paid', state: 'COMMITTED' };
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM membership_founding_reservations WHERE reservation_id')) return [heldRow];
      if (sql.includes("UPDATE membership_founding_reservations SET state = 'COMMITTED'")) return [committed];
      return [];
    });
    const result = await commitFoundingReservationAfterVerifiedPayment(
      poolFor(client),
      heldRow.reservation_id,
      'evt_payment_succeeded_1',
      new Date('2026-11-29T12:30:00.000Z'),
      new Date('2026-11-29T12:10:00.000Z'),
    );
    const update = client.statements.find((entry) => entry.sql.includes("UPDATE membership_founding_reservations SET state = 'COMMITTED'"));
    expect(result.state).toBe('COMMITTED');
    expect(update?.sql).toContain('expires_at > $3');
    expect(update?.values[1]).toBe('2026-11-29T12:30:00.000Z');
    expect(update?.values[2]).toBe('2026-11-29T12:10:00.000Z');
    expect(client.statements.some((entry) => entry.sql === 'COMMIT')).toBe(true);
  });

  it('rejects a payment confirmed after the reservation expired', async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM membership_founding_reservations WHERE reservation_id')) return [heldRow];
      return [];
    });
    await expect(commitFoundingReservationAfterVerifiedPayment(
      poolFor(client),
      heldRow.reservation_id,
      'evt_payment_succeeded_2',
      new Date('2026-11-29T12:30:00.000Z'),
      new Date('2026-11-29T12:16:00.000Z'),
    )).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
    expect(client.statements.some((entry) => entry.sql.includes("UPDATE membership_founding_reservations SET state = 'COMMITTED'"))).toBe(false);
    expect(client.statements.some((entry) => entry.sql === 'ROLLBACK')).toBe(true);
  });

  it('fails closed when plan versions disagree on the founding capacity', async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('SELECT plan_id FROM membership_plans')) return [{ plan_id: 'plan_founder' }];
      if (sql.includes('WHERE subscriber_id = $1 AND idempotency_key = $2')) return [];
      if (sql.includes('SELECT p.current_version')) return [{
        current_version: 1, offer_kind: 'FOUNDING', founding_capacity: 5, min_capacity: 5, max_capacity: 8,
      }];
      return [];
    });
    await expect(reserveFoundingOfferCapacity(poolFor(client), {
      planId: 'plan_founder', planVersion: 1, subscriberId: 'subscriber_1',
      idempotencyKey: 'reserve-3',
    })).rejects.toMatchObject({ code: 'INVALID_STATE', status: 409 });
    expect(client.statements.some((entry) => entry.sql.includes('INSERT INTO membership_founding_reservations'))).toBe(false);
  });
});
