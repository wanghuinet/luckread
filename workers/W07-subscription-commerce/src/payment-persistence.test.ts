import { describe, expect, it } from 'vitest';
import { sha256CanonicalJsonForIdempotency } from '../../W10-async/src/canonical-json-idempotency.js';
import {
  createPaymentAttempt,
  recordUnconfirmedHyperswitchIntent,
  receiveHyperswitchWebhook,
  PaymentPersistenceError,
  type PaymentAttemptStatus,
} from './payment-persistence.js';
import type { HyperswitchPayment } from './hyperswitch-client.js';

const NOW = '2026-10-28T12:00:00.000Z';
const LATER = '2026-10-28T12:00:01.000Z';
const CUSTOMER = 'user_1';
const MERCHANT = 'merchant_test';
const SECRET = 'webhook_test_secret';
const PAYMENT_ID = 'pay_' + 'a'.repeat(26);
const METHOD_ID = 'pm_hyperswitch_test_123';
const PROVIDER_MANDATE_ID = 'mandate_hyperswitch_test_123';

type Row = Record<string, unknown>;
type Order = { order_id: string; customer_id: string; status: string; version: number; currency: string; total_minor: number; has_demo_pricing: number; updated_at: string; confirmed_at: string | null };
type Payment = {
  payment_id: string; order_id: string; customer_id: string; provider: string; merchant_id: string;
  amount_minor: number; currency: string; status: PaymentAttemptStatus; version: number;
  idempotency_key: string; request_hash: string; provider_updated_at: string | null;
  failure_code: string | null; created_at: string; updated_at: string;
};
type Event = {
  event_row_id: string; provider: string; merchant_id: string; event_id: string;
  event_type: string; payment_id: string | null; payload_sha256: string;
  state: 'RECEIVED' | 'APPLIED' | 'RECONCILIATION_REQUIRED' | 'REJECTED';
  received_at: string; processed_at: string | null; outcome_code: string | null;
};
type Conflict = {
  conflict_id: string; provider: string; merchant_id: string; event_id: string;
  existing_payload_sha256: string; incoming_payload_sha256: string; state: 'OPEN' | 'RESOLVED';
  occurrence_count: number; version: number; first_seen_at: string; last_seen_at: string;
  resolved_at: string | null; resolution_code: string | null;
};
type SavedMethod = {
  saved_payment_method_id: string; provider: string; merchant_id: string; customer_id: string;
  payment_method_id: string; source_payment_id: string; source_event_id: string; created_at: string;
};
type Mandate = {
  mandate_record_id: string; provider: string; merchant_id: string; customer_id: string;
  payment_method_id: string; source_payment_id: string; source_event_id: string;
  consent_accepted_at: string; consent_acceptance_type: 'online'; consent_scope: 'OFF_SESSION_RECURRING';
  consent_terms_version: 'luckread-recurring-consent-v1'; provider_mandate_id: string | null;
  status: 'PENDING_PROVIDER_CONFIRMATION' | 'ACTIVE' | 'REVOKED' | 'FAILED' | 'EXPIRED';
  version: number; provider_updated_at: string | null; created_at: string; updated_at: string;
};

const clone = <T>(value: T): T => structuredClone(value);
function result(changes: number): D1Result {
  return { success: true, meta: { changes } } as D1Result;
}

class MemoryPaymentStatement {
  values: unknown[] = [];
  constructor(readonly db: MemoryPaymentD1, readonly sql: string) {}
  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values;
    return this as unknown as D1PreparedStatement;
  }
  async first<T>(): Promise<T | null> {
    return this.db.first<T>(this.sql, this.values);
  }
  async run<T>(): Promise<D1Result<T>> {
    return this.db.run<T>(this.sql, this.values);
  }
}

class MemoryPaymentD1 {
  orders: Order[] = [];
  payments: Payment[] = [];
  events: Event[] = [];
  conflicts: Conflict[] = [];
  savedMethods: SavedMethod[] = [];
  mandates: Mandate[] = [];
  prepare(sql: string): D1PreparedStatement {
    return new MemoryPaymentStatement(this, sql) as unknown as D1PreparedStatement;
  }
  async first<T>(sql: string, values: unknown[]): Promise<T | null> {
    let row: Row | undefined;
    if (sql.includes('FROM orders')) {
      const [orderId, customerId] = values;
      row = this.orders.find(o => o.order_id === orderId && o.customer_id === customerId);
    } else if (sql.includes('FROM payments') && sql.includes('idempotency_key = ?')) {
      const [customerId, key] = values;
      row = this.payments.find(p => p.customer_id === customerId && p.idempotency_key === key);
    } else if (sql.includes('FROM payments') && sql.includes('order_id = ?')) {
      const [customerId, orderId] = values;
      row = this.payments.find(p => p.customer_id === customerId && p.order_id === orderId &&
        !['failed', 'cancelled', 'cancelled_post_capture', 'expired'].includes(p.status));
    } else if (sql.includes('FROM payments') && sql.includes('WHERE provider = ? AND payment_id = ?')) {
      const [provider, paymentId] = values;
      row = this.payments.find(p => p.provider === provider && p.payment_id === paymentId);
    } else if (sql.includes('FROM payments') && sql.includes('payment_id = ?')) {
      const [paymentId, customerId] = values;
      row = this.payments.find(p => p.payment_id === paymentId && p.customer_id === customerId);
    } else if (sql.includes('FROM payment_provider_events')) {
      const [provider, merchantId, eventId] = values;
      row = this.events.find(e => e.provider === provider && e.merchant_id === merchantId && e.event_id === eventId);
    } else if (sql.includes('FROM payment_provider_event_conflicts')) {
      const [provider, merchantId, eventId, incomingHash] = values;
      row = this.conflicts.find(c => c.provider === provider && c.merchant_id === merchantId &&
        c.event_id === eventId && c.incoming_payload_sha256 === incomingHash);
    } else if (sql.includes('FROM payment_mandates')) {
      const [provider, merchantId, methodId, providerMandateId, sourcePaymentId] = values as
        [string, string, string, string, string];
      row = this.mandates.find(m => m.provider === provider && m.merchant_id === merchantId &&
        m.payment_method_id === methodId &&
        (m.provider_mandate_id === providerMandateId ||
          (m.provider_mandate_id === null && m.source_payment_id === sourcePaymentId)));
    } else if (sql.includes('FROM subscription_renewal_cycles')) {
      // Payment-webhook tests without a seeded renewal cycle model the normal
      // customer-present payment path; no cycle-specific state update is expected.
      row = undefined;
    } else {
      throw new Error('Unexpected first query: ' + sql);
    }
    return row ? clone(row) as T : null;
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    const snapshot = clone({ orders: this.orders, payments: this.payments, events: this.events, conflicts: this.conflicts, savedMethods: this.savedMethods, mandates: this.mandates });
    try {
      const results: D1Result[] = [];
      for (const statement of statements as unknown as MemoryPaymentStatement[]) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      this.orders = snapshot.orders;
      this.payments = snapshot.payments;
      this.events = snapshot.events;
      this.conflicts = snapshot.conflicts;
      this.savedMethods = snapshot.savedMethods;
      this.mandates = snapshot.mandates;
      throw error;
    }
  }

  async run<T>(sql: string, values: unknown[]): Promise<D1Result<T>> {
    if (sql.startsWith('INSERT INTO payments')) {
      const [paymentId, orderId, customerId, merchantId, amount, currency, key, requestHash, createdAt, updatedAt] = values as
        [string, string, string, string, number, string, string, string, string, string];
      const provider = 'hyperswitch';
      const status: PaymentAttemptStatus = 'INITIATING';
      const version = 1;
      const providerUpdatedAt: string | null = null;
      const failureCode: string | null = null;
      const order = this.orders.find(o => o.order_id === orderId && o.customer_id === customerId &&
        o.currency === currency && o.total_minor === amount && amount > 0 &&
        ['CREATED', 'PENDING_PAYMENT'].includes(o.status));
      if (!order || provider !== 'hyperswitch') throw new Error('constraint: payable order');
      if (this.payments.some(p => p.customer_id === customerId && p.idempotency_key === key)) throw new Error('constraint: idem');
      if (this.payments.some(p => p.order_id === orderId &&
        !['failed', 'cancelled', 'cancelled_post_capture', 'expired'].includes(p.status))) throw new Error('constraint: live payment');
      this.payments.push({
        payment_id: paymentId, order_id: orderId, customer_id: customerId, provider,
        merchant_id: merchantId, amount_minor: amount, currency, status, version,
        idempotency_key: key, request_hash: requestHash, provider_updated_at: providerUpdatedAt,
        failure_code: failureCode, created_at: createdAt, updated_at: updatedAt,
      });
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith("UPDATE orders SET status = 'CONFIRMED'")) {
      const [confirmedAt, updatedAt, orderId, customerId, currency, amount, oldStatus, version,
        paymentId, providerUpdatedAt, eventProvider, eventMerchant, eventId, payloadHash] = values as
        [string, string, string, string, string, number, string, number, string, string, string, string, string, string];
      const order = this.orders.find(o => o.order_id === orderId && o.customer_id === customerId &&
        o.currency === currency && o.total_minor === amount && o.status === oldStatus && o.version === version &&
        ['CREATED', 'PENDING_PAYMENT'].includes(o.status));
      const payment = this.payments.find(p => p.payment_id === paymentId && p.order_id === orderId &&
        p.customer_id === customerId && p.provider === 'hyperswitch' && p.status === 'succeeded' &&
        p.provider_updated_at === providerUpdatedAt);
      const receipt = this.events.find(e => e.provider === eventProvider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      if (!order || !payment || !receipt) return result(0) as D1Result<T>;
      order.status = 'CONFIRMED';
      order.version += 1;
      order.confirmed_at = confirmedAt;
      order.updated_at = updatedAt;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payments SET status = ?') && sql.includes('provider_updated_at = ?')) {
      const [status, providerUpdatedAt, updatedAt, paymentId, provider, merchantId, amount, currency,
        version, oldStatus, timestampGuard, eventProvider, eventMerchant, eventId, payloadHash] = values as
        [PaymentAttemptStatus, string, string, string, string, string, number, string, number,
          PaymentAttemptStatus, string, string, string, string, string];
      const row = this.payments.find(p => p.payment_id === paymentId && p.provider === provider &&
        p.merchant_id === merchantId && p.amount_minor === amount && p.currency === currency &&
        p.version === version && p.status === oldStatus &&
        (p.provider_updated_at === null || p.provider_updated_at < timestampGuard));
      const receipt = this.events.find(e => e.provider === eventProvider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      if (!row || !receipt) return result(0) as D1Result<T>;
      row.status = status;
      row.version += 1;
      row.provider_updated_at = providerUpdatedAt;
      row.updated_at = updatedAt;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payments SET status = ?')) {
      const [status, updatedAt, paymentId, customerId, merchantId, amount, currency] = values as
        [PaymentAttemptStatus, string, string, string, string, number, string];
      const row = this.payments.find(p => p.payment_id === paymentId && p.customer_id === customerId &&
        p.merchant_id === merchantId && p.amount_minor === amount && p.currency === currency &&
        p.status === 'INITIATING' && p.version === 1);
      if (!row) return result(0) as D1Result<T>;
      row.status = status;
      row.version += 1;
      row.updated_at = updatedAt;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('INSERT INTO payment_provider_events')) {
      const rowId = values[0] as string;
      const provider = values[1] as string;
      const merchantId = values[2] as string;
      const eventId = values[3] as string;
      const eventType = values[4] as string;
      // The mandate INSERT uses a SQL literal NULL for payment_id, so it has
      // one fewer bound value than the payment-event INSERT variants.
      const hasLiteralNullPaymentId = sql.includes("?, ?, ?, ?, ?, NULL, ?, 'RECEIVED'");
      const paymentId = hasLiteralNullPaymentId ? null : values[5] as string | null;
      const hash = values[hasLiteralNullPaymentId ? 5 : 6] as string;
      const receivedAt = values[hasLiteralNullPaymentId ? 6 : 7] as string;
      if (this.events.some(e => e.provider === provider && e.merchant_id === merchantId && e.event_id === eventId)) {
        return result(0) as D1Result<T>; // ON CONFLICT DO NOTHING
      }
      this.events.push({
        event_row_id: rowId, provider, merchant_id: merchantId, event_id: eventId,
        event_type: eventType, payment_id: paymentId, payload_sha256: hash, state: 'RECEIVED',
        received_at: receivedAt, processed_at: null, outcome_code: null,
      });
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith("UPDATE payment_provider_events SET state = 'RECEIVED'")) {
      const [provider, merchantId, eventId, payloadHash] = values as [string, string, string, string];
      const row = this.events.find(e => e.provider === provider && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECONCILIATION_REQUIRED');
      if (!row) return result(0) as D1Result<T>;
      row.state = 'RECEIVED';
      row.processed_at = null;
      row.outcome_code = null;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payment_provider_events SET state = CASE WHEN EXISTS') &&
        sql.includes('FROM payment_mandates m')) {
      const [mandateId, provider, merchantId, providerMandateId, methodId, status, providerTimestamp,
        processedAt] = values.slice(0, 8) as
        [string, string, string, string, string, Mandate['status'], string, string];
      const eventValues = values.slice(-4) as [string, string, string, string];
      const [eventProvider, eventMerchant, eventId, payloadHash] = eventValues;
      const mandate = this.mandates.find(m => m.mandate_record_id === mandateId && m.provider === provider &&
        m.merchant_id === merchantId && m.provider_mandate_id === providerMandateId &&
        m.payment_method_id === methodId && m.status === status && m.provider_updated_at === providerTimestamp);
      const receipt = this.events.find(e => e.provider === eventProvider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      if (!receipt) return result(0) as D1Result<T>;
      const applied = Boolean(mandate);
      receipt.state = applied ? 'APPLIED' : 'RECONCILIATION_REQUIRED';
      receipt.processed_at = processedAt;
      receipt.outcome_code = applied ? 'MANDATE_STATUS_APPLIED' : 'MANDATE_STATUS_CAS_LOST_OR_OUT_OF_ORDER';
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payment_mandates SET provider_mandate_id = COALESCE')) {
      const [providerMandateId, status, providerUpdatedAt, updatedAt, mandateId, provider, merchantId,
        matchedMandateId, sourcePaymentId, methodId, version, oldStatus, timestampGuard,
        activeStatus, revokedStatus, eventProvider, eventMerchant, eventId, payloadHash] = values as
        [string, Mandate['status'], string, string, string, string, string, string, string,
         string, number, Mandate['status'], string, Mandate['status'], Mandate['status'],
         string, string, string, string];
      const mandate = this.mandates.find(m => m.mandate_record_id === mandateId && m.provider === provider &&
        m.merchant_id === merchantId && m.payment_method_id === methodId &&
        (m.provider_mandate_id === matchedMandateId ||
          (m.provider_mandate_id === null && m.source_payment_id === sourcePaymentId)) &&
        m.version === version && m.status === oldStatus &&
        (m.provider_updated_at === null || m.provider_updated_at < timestampGuard));
      const receipt = this.events.find(e => e.provider === eventProvider && e.merchant_id === eventMerchant &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      const transitionAllowed = activeStatus === 'ACTIVE'
        ? ['PENDING_PROVIDER_CONFIRMATION', 'ACTIVE'].includes(oldStatus)
        : revokedStatus === 'REVOKED'
          ? ['PENDING_PROVIDER_CONFIRMATION', 'ACTIVE', 'REVOKED'].includes(oldStatus)
          : false;
      if (!mandate || !receipt || !transitionAllowed) return result(0) as D1Result<T>;
      mandate.provider_mandate_id = providerMandateId;
      mandate.status = status;
      mandate.provider_updated_at = providerUpdatedAt;
      mandate.updated_at = updatedAt;
      mandate.version += 1;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payment_provider_events SET state = CASE WHEN EXISTS')) {
      const succeededEvent = sql.includes('FROM orders o');
      const eventIdentity = values.slice(-4) as [string, string, string, string];
      const [provider, merchantId, eventId, payloadHash] = eventIdentity;
      const [targetPaymentId, targetProvider, targetMerchant, targetAmount, targetCurrency, targetStatus, targetTimestamp] =
        values.slice(0, 7) as [string, string, string, number, string, PaymentAttemptStatus, string];
      const payment = this.payments.find(p => p.payment_id === targetPaymentId && p.provider === targetProvider &&
        p.merchant_id === targetMerchant && p.amount_minor === targetAmount && p.currency === targetCurrency &&
        p.status === targetStatus && p.provider_updated_at === targetTimestamp);
      const receipt = this.events.find(e => e.provider === provider && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      if (!receipt) return result(0) as D1Result<T>;

      let orderConfirmed = true;
      if (succeededEvent) {
        const orderValues = values.slice(7, 11) as [string, string, string, number];
        const [orderId, customerId, currency, amount] = orderValues;
        orderConfirmed = this.orders.some(o => o.order_id === orderId && o.customer_id === customerId &&
          o.currency === currency && o.total_minor === amount && ['CONFIRMED', 'PROCESSING', 'COMPLETED'].includes(o.status));
      }

      const applied = Boolean(payment) && (!succeededEvent || orderConfirmed);
      receipt.state = applied ? 'APPLIED' : 'RECONCILIATION_REQUIRED';
      receipt.processed_at = values[succeededEvent ? 11 : 7] as string;
      receipt.outcome_code = applied
        ? (succeededEvent ? 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED' : 'PAYMENT_STATUS_APPLIED')
        : (payment && succeededEvent ? 'ORDER_CONFIRMATION_REQUIRED' : 'PAYMENT_STATUS_CAS_LOST');
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payment_provider_events SET state = ?')) {
      const [state, processedAt, outcomeCode, provider, merchantId, eventId, payloadHash] = values as
        [Event['state'], string, string, string, string, string, string];
      const row = this.events.find(e => e.provider === provider && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payload_sha256 === payloadHash && e.state === 'RECEIVED');
      if (!row) return result(0) as D1Result<T>;
      row.state = state;
      row.processed_at = processedAt;
      row.outcome_code = outcomeCode;
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('INSERT INTO saved_payment_methods')) {
      const [id, merchantId, customerId, methodId, paymentId, eventId, createdAt] = values as
        [string, string, string, string, string, string, string];
      const payment = this.payments.find(p => p.payment_id === paymentId && p.provider === 'hyperswitch' &&
        p.merchant_id === merchantId && p.customer_id === customerId && p.status === 'succeeded');
      const event = this.events.find(e => e.provider === 'hyperswitch' && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payment_id === paymentId && e.event_type === 'payment_succeeded' && e.state === 'RECEIVED');
      if (!payment || !event) throw new Error('constraint: verified succeeded payment required for saved method');
      const existing = this.savedMethods.find(m => m.provider === 'hyperswitch' &&
        m.merchant_id === merchantId && m.payment_method_id === methodId);
      if (existing && existing.customer_id !== customerId) throw new Error('constraint: saved method customer binding');
      if (existing) return result(0) as D1Result<T>;
      this.savedMethods.push({
        saved_payment_method_id: id, provider: 'hyperswitch', merchant_id: merchantId,
        customer_id: customerId, payment_method_id: methodId, source_payment_id: paymentId,
        source_event_id: eventId, created_at: createdAt,
      });
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('INSERT INTO payment_mandates')) {
      const [id, merchantId, customerId, methodId, paymentId, eventId, acceptedAt,
        providerMandateId, createdAt, updatedAt] = values as
        [string, string, string, string, string, string, string, string | null, string, string];
      const saved = this.savedMethods.find(m => m.provider === 'hyperswitch' && m.merchant_id === merchantId &&
        m.customer_id === customerId && m.payment_method_id === methodId);
      const payment = this.payments.find(p => p.payment_id === paymentId && p.provider === 'hyperswitch' &&
        p.merchant_id === merchantId && p.customer_id === customerId && p.status === 'succeeded');
      const event = this.events.find(e => e.provider === 'hyperswitch' && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payment_id === paymentId && e.event_type === 'payment_succeeded' && e.state === 'RECEIVED');
      if (!saved || !payment || !event) throw new Error('constraint: mandate requires saved method and verified payment');
      if (this.mandates.some(m => m.provider === 'hyperswitch' && m.merchant_id === merchantId && m.source_payment_id === paymentId)) {
        return result(0) as D1Result<T>;
      }
      if (providerMandateId && this.mandates.some(m => m.provider === 'hyperswitch' &&
        m.merchant_id === merchantId && m.provider_mandate_id === providerMandateId)) throw new Error('constraint: provider mandate uniqueness');
      this.mandates.push({
        mandate_record_id: id, provider: 'hyperswitch', merchant_id: merchantId, customer_id: customerId,
        payment_method_id: methodId, source_payment_id: paymentId, source_event_id: eventId,
        consent_accepted_at: acceptedAt, consent_acceptance_type: 'online', consent_scope: 'OFF_SESSION_RECURRING',
        consent_terms_version: 'luckread-recurring-consent-v1', provider_mandate_id: providerMandateId,
        status: 'PENDING_PROVIDER_CONFIRMATION', version: 1, provider_updated_at: null,
        created_at: createdAt, updated_at: updatedAt,
      });
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith("UPDATE payment_method_revocation_requests SET status = 'COMPLETED'")) {
      // These existing payment-persistence test cases do not seed removal requests.
      return result(0) as D1Result<T>;
    }
    if (sql.startsWith('INSERT INTO payment_provider_event_conflicts')) {
      // State/count/version are SQL literals ('OPEN', 1, 1), not bound values.
      const [conflictId, provider, merchantId, eventId, oldHash, newHash, firstAt, lastAt] = values as
        [string, string, string, string, string, string, string, string];
      const firstReceipt = this.events.find(e => e.provider === provider && e.merchant_id === merchantId &&
        e.event_id === eventId && e.payload_sha256 === oldHash);
      if (!firstReceipt || oldHash === newHash) throw new Error('constraint: first receipt evidence');
      if (this.conflicts.some(c => c.provider === provider && c.merchant_id === merchantId &&
        c.event_id === eventId && c.incoming_payload_sha256 === newHash)) throw new Error('constraint: conflict uniqueness');
      this.conflicts.push({
        conflict_id: conflictId, provider, merchant_id: merchantId, event_id: eventId,
        existing_payload_sha256: oldHash, incoming_payload_sha256: newHash, state: 'OPEN',
        occurrence_count: 1, version: 1, first_seen_at: firstAt, last_seen_at: lastAt,
        resolved_at: null, resolution_code: null,
      });
      return result(1) as D1Result<T>;
    }
    if (sql.startsWith('UPDATE payment_provider_event_conflicts SET occurrence_count')) {
      const [lastSeen, conflictId, version, count] = values as [string, string, number, number];
      const row = this.conflicts.find(c => c.conflict_id === conflictId && c.state === 'OPEN' &&
        c.version === version && c.occurrence_count === count);
      if (!row) return result(0) as D1Result<T>;
      row.occurrence_count += 1;
      row.version += 1;
      row.last_seen_at = lastSeen;
      return result(1) as D1Result<T>;
    }
    throw new Error('Unexpected run query: ' + sql);
  }
}

const fixedDeps = (time = NOW) => ({
  now: () => new Date(time),
  createPaymentId: () => PAYMENT_ID,
  createEventRowId: () => 'evtrow_test_1',
  createConflictId: () => 'evtconf_test_1',
  createSavedPaymentMethodId: () => 'spm_' + 's'.repeat(26),
  createPaymentMandateId: () => 'mnd_' + 'm'.repeat(26),
});

function seedOrder(db: MemoryPaymentD1, overrides: Partial<Order> = {}) {
  db.orders.push({
    order_id: 'ord_1', customer_id: CUSTOMER, status: 'CREATED', version: 1,
    currency: 'USD', total_minor: 1200, has_demo_pricing: 0, updated_at: NOW, confirmed_at: null, ...overrides,
  });
}

function seedPayment(db: MemoryPaymentD1, overrides: Partial<Payment> = {}) {
  db.payments.push({
    payment_id: PAYMENT_ID,
    order_id: 'ord_1',
    customer_id: CUSTOMER,
    provider: 'hyperswitch',
    merchant_id: MERCHANT,
    amount_minor: 1200,
    currency: 'USD',
    status: 'INITIATING',
    version: 1,
    idempotency_key: 'payment_key_1',
    request_hash: 'a'.repeat(64),
    provider_updated_at: null,
    failure_code: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

function seedMandate(db: MemoryPaymentD1, overrides: Partial<Mandate> = {}) {
  db.mandates.push({
    mandate_record_id: 'mnd_' + 'm'.repeat(26),
    provider: 'hyperswitch',
    merchant_id: MERCHANT,
    customer_id: CUSTOMER,
    payment_method_id: METHOD_ID,
    source_payment_id: PAYMENT_ID,
    source_event_id: 'evt_saved_method',
    consent_accepted_at: NOW,
    consent_acceptance_type: 'online',
    consent_scope: 'OFF_SESSION_RECURRING',
    consent_terms_version: 'luckread-recurring-consent-v1',
    provider_mandate_id: PROVIDER_MANDATE_ID,
    status: 'PENDING_PROVIDER_CONFIRMATION',
    version: 1,
    provider_updated_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  });
}

const mandateBody = (
  eventId: string,
  eventType: 'mandate_active' | 'mandate_revoked',
  status: 'active' | 'revoked',
  timestamp = NOW,
  overrides: Record<string, unknown> = {},
) => JSON.stringify({
  merchant_id: MERCHANT,
  event_id: eventId,
  event_type: eventType,
  content: {
    type: 'mandate_details',
    object: {
      mandate_id: PROVIDER_MANDATE_ID,
      payment_method_id: METHOD_ID,
      status,
      ...overrides,
    },
  },
  timestamp,
});

function expectPaymentError(promise: Promise<unknown>, code: string) {
  return expect(promise).rejects.toMatchObject({ code, status: expect.any(Number) });
}

const bodyText = (
  eventId: string,
  updated = '2026-10-28T12:00:00.000Z',
  includeSavedMethodConsent = false,
) => {
  const resource: Record<string, unknown> = {
    payment_id: PAYMENT_ID,
    merchant_id: MERCHANT,
    amount: 1200,
    currency: 'USD',
    status: 'succeeded',
    updated,
  };
  if (includeSavedMethodConsent) {
    Object.assign(resource, {
      customer_id: CUSTOMER,
      payment_method_id: 'pm_hyperswitch_test_123',
      mandate_id: 'mandate_hyperswitch_test_123',
      mandate_data: {
        customer_acceptance: {
          accepted_at: NOW,
          online: { ip_address: '192.0.2.1', user_agent: 'LuckRead test client' },
        },
      },
    });
  }
  return JSON.stringify({
    merchant_id: MERCHANT,
    event_id: eventId,
    event_type: 'payment_succeeded',
    content: { type: 'payment_details', object: resource },
  });
};

async function signedBody(text: string, secret = SECRET): Promise<{ rawBody: ArrayBuffer; signature: string; signatureHeader: string }> {
  const bytes = new TextEncoder().encode(text);
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign'],
  );
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes));
  const signature = Array.from(signatureBytes, b => b.toString(16).padStart(2, '0')).join('');
  return {
    rawBody: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    // Keep the cryptographic value named for both legacy test helpers and the
    // production receive contract so spreading this object cannot omit the header.
    signature,
    signatureHeader: signature,
  };
}

describe('PAY-001 payment attempt persistence candidate', () => {
  it('blocks Demo-priced orders in production even when a previous payment attempt exists', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db, { has_demo_pricing: 1 });
    seedPayment(db);
    await expect(createPaymentAttempt(
      db as unknown as D1Database, CUSTOMER, 'ord_1', 'payment_key_1', MERCHANT, fixedDeps(),
    )).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    expect(db.payments).toHaveLength(1);
  });

  it('allows Demo-priced orders only in sandbox and records the pricing mode', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db, { has_demo_pricing: 1 });
    const created = await createPaymentAttempt(
      db as unknown as D1Database, CUSTOMER, 'ord_1', 'demo_key_1', MERCHANT,
      { ...fixedDeps(), paymentEnvironment: 'sandbox' },
    );
    expect(created.pricingMode).toBe('demo');
    expect(db.payments).toHaveLength(1);
  });

  it('creates a stable unconfirmed attempt and replays the same idempotency key without a second write', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    const created = await createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps());
    // Simulate the successful purchase lifecycle completing before a retry of
    // the original create request reaches W07.
    db.orders[0]!.status = 'COMPLETED';
    db.payments[0]!.status = 'succeeded';
    db.payments[0]!.version = 3;
    const replay = await createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps(LATER));
    expect(created).toMatchObject({ replayed: false, payment: { paymentId: PAYMENT_ID, status: 'INITIATING', version: 1 } });
    expect(replay).toMatchObject({ replayed: true, payment: { paymentId: PAYMENT_ID, status: 'succeeded', version: 3 } });
    expect(db.payments).toHaveLength(1);
    expect(JSON.stringify(created)).not.toContain('merchant_test');
    expect(JSON.stringify(created)).not.toContain('request_hash');
  });

  it('uses W10 canonical fingerprints for new payments and replays legacy hashes already stored in D1-04', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    const created = await createPaymentAttempt(
      db as unknown as D1Database, CUSTOMER, 'ord_1', 'legacy_key_1', MERCHANT, fixedDeps(),
    );

    const payload = {
      operation: 'createPaymentAttempt',
      customerId: CUSTOMER,
      orderId: 'ord_1',
      provider: 'hyperswitch',
      merchantId: MERCHANT,
      amountMinor: 1200,
      currency: 'USD',
    };
    const canonical = await sha256CanonicalJsonForIdempotency(payload, 8192);
    expect(db.payments[0]!.request_hash).toBe(canonical.slice('sha256:'.length));
    expect(db.payments[0]!.request_hash).toMatch(/^[0-9a-f]{64}$/);

    const legacyBytes = new TextEncoder().encode(JSON.stringify(payload));
    const legacyDigest = await crypto.subtle.digest('SHA-256', legacyBytes);
    db.payments[0]!.request_hash = Array.from(
      new Uint8Array(legacyDigest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');

    const replay = await createPaymentAttempt(
      db as unknown as D1Database, CUSTOMER, 'ord_1', 'legacy_key_1', MERCHANT, fixedDeps(LATER),
    );
    expect(created.replayed).toBe(false);
    expect(replay).toMatchObject({
      replayed: true,
      payment: { paymentId: PAYMENT_ID, status: 'INITIATING', version: 1 },
    });
    expect(db.payments).toHaveLength(1);
  });

  it('rejects reuse of the same customer key for a different order or commercial snapshot', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    await createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps());
    seedOrder(db, { order_id: 'ord_2', total_minor: 2500 });
    await expectPaymentError(
      createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_2', 'key_1', MERCHANT, fixedDeps()),
      'IDEMPOTENCY_KEY_REUSE_CONFLICT',
    );
    expect(db.payments).toHaveLength(1);
  });

  it('returns not-found for nonexistent and foreign-owned orders without leaking ownership', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db, { customer_id: 'other_user' });
    await expectPaymentError(
      createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps()),
      'RESOURCE_NOT_FOUND',
    );
    await expectPaymentError(
      createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'missing_order', 'key_2', MERCHANT, fixedDeps()),
      'RESOURCE_NOT_FOUND',
    );
  });

  it('rejects a second live payment attempt for the same order when a different key is supplied', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    await createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps());
    await expectPaymentError(
      createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_2', MERCHANT,
        { ...fixedDeps(LATER), createPaymentId: () => 'pay_' + 'b'.repeat(26) }),
      'CONFLICT',
    );
    expect(db.payments).toHaveLength(1);
  });

  it('accepts the existing provider intent only after strict merchant, amount and currency matching', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    await createPaymentAttempt(db as unknown as D1Database, CUSTOMER, 'ord_1', 'key_1', MERCHANT, fixedDeps());
    const providerPayment: HyperswitchPayment = {
      paymentId: PAYMENT_ID, merchantId: MERCHANT, amount: 1200, currency: 'USD',
      status: 'requires_payment_method', clientSecret: 'secret_must_not_persist',
    };
    const saved = await recordUnconfirmedHyperswitchIntent(
      db as unknown as D1Database, CUSTOMER, PAYMENT_ID, MERCHANT, providerPayment, { now: () => new Date(NOW) },
    );
    expect(saved).toMatchObject({ status: 'requires_payment_method', version: 2, updatedAt: '2026-10-28T12:00:00.001Z' });
    expect(JSON.stringify(db.payments)).not.toContain('secret_must_not_persist');

    await expectPaymentError(
      recordUnconfirmedHyperswitchIntent(
        db as unknown as D1Database, CUSTOMER, PAYMENT_ID, 'another_merchant',
        { ...providerPayment, merchantId: 'another_merchant' }, { now: () => new Date(LATER) },
      ),
      'WEBHOOK_REJECTED',
    );
    await expectPaymentError(
      recordUnconfirmedHyperswitchIntent(
        db as unknown as D1Database, CUSTOMER, PAYMENT_ID, MERCHANT,
        { ...providerPayment, amount: 1199 }, { now: () => new Date(LATER) },
      ),
      'WEBHOOK_REJECTED',
    );
  });

  it('verifies signatures before storing and deduplicates identical provider events', async () => {
    const db = new MemoryPaymentD1();
    const signed = await signedBody(bodyText('evt_1'));
    const input = { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT };
    const first = await receiveHyperswitchWebhook(db as unknown as D1Database, input, fixedDeps());
    const rawBodyDigest = await crypto.subtle.digest('SHA-256', input.rawBody);
    const expectedPayloadHash = Array.from(
      new Uint8Array(rawBodyDigest),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    expect(first.payloadSha256).toBe(expectedPayloadHash);

    const duplicate = await receiveHyperswitchWebhook(db as unknown as D1Database, input, fixedDeps(LATER));
    expect(first).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', eventId: 'evt_1', state: 'RECONCILIATION_REQUIRED' });
    expect(duplicate).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED', receiptId: first.receiptId });
    expect(db.events).toHaveLength(1);
    expect(db.conflicts).toHaveLength(0);
    expect(JSON.stringify(db.events)).not.toContain(bodyText('evt_1'));
    expect(JSON.stringify(db.events)).not.toContain(SECRET);
  });


  it('atomically applies a signed payment success and confirms the matching Order', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db);
    const signed = await signedBody(bodyText('evt_success'));
    const input = { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT };

    const applied = await receiveHyperswitchWebhook(db as unknown as D1Database, input, fixedDeps());
    expect(applied).toMatchObject({
      outcome: 'APPLIED',
      eventId: 'evt_success',
      state: 'APPLIED',
    });
    expect(db.payments[0]).toMatchObject({
      payment_id: PAYMENT_ID,
      status: 'succeeded',
      version: 2,
      provider_updated_at: NOW,
      updated_at: '2026-10-28T12:00:00.001Z',
    });
    expect(db.events[0]).toMatchObject({
      event_id: 'evt_success',
      state: 'APPLIED',
      outcome_code: 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED',
      processed_at: NOW,
    });
    expect(db.orders[0]).toMatchObject({ status: 'CONFIRMED', version: 2, confirmed_at: '2026-10-28T12:00:00.001Z' });
    expect(db.savedMethods).toHaveLength(0);
    expect(db.mandates).toHaveLength(0);

    const duplicate = await receiveHyperswitchWebhook(db as unknown as D1Database, input, fixedDeps(LATER));
    expect(duplicate).toMatchObject({ outcome: 'DUPLICATE', receiptId: applied.receiptId });
    expect(db.payments[0]?.version).toBe(2);
    expect(db.events).toHaveLength(1);
  });

  it('applies later signed success events when the paid Order has already advanced through fulfillment', async () => {
    for (const status of ['CONFIRMED', 'PROCESSING', 'COMPLETED'] as const) {
      const db = new MemoryPaymentD1();
      seedOrder(db, {
        status,
        version: status === 'CONFIRMED' ? 2 : status === 'PROCESSING' ? 3 : 4,
        updated_at: LATER,
        confirmed_at: '2026-10-28T12:00:00.001Z',
      });
      seedPayment(db, {
        status: 'succeeded',
        version: 2,
        provider_updated_at: NOW,
        updated_at: '2026-10-28T12:00:00.001Z',
      });
      const signed = await signedBody(bodyText('evt_success_after_' + status.toLowerCase(), '2026-10-28T12:00:02.000Z'));
      const result = await receiveHyperswitchWebhook(
        db as unknown as D1Database,
        { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
        fixedDeps('2026-10-28T12:00:03.000Z'),
      );

      expect(result).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED' });
      expect(db.events[0]).toMatchObject({
        state: 'APPLIED',
        outcome_code: 'PAYMENT_STATUS_APPLIED_AND_ORDER_CONFIRMED',
      });
      expect(db.payments[0]).toMatchObject({ status: 'succeeded', version: 3 });
      expect(db.orders[0]).toMatchObject({ status, confirmed_at: '2026-10-28T12:00:00.001Z' });
    }
  });


  it('persists only provider-signed customer-bound off-session consent and leaves mandate pending', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db);
    const signed = await signedBody(bodyText('evt_saved_method', NOW, true));
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );

    expect(applied).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED' });
    expect(db.savedMethods).toEqual([{
      saved_payment_method_id: 'spm_' + 's'.repeat(26),
      provider: 'hyperswitch',
      merchant_id: MERCHANT,
      customer_id: CUSTOMER,
      payment_method_id: 'pm_hyperswitch_test_123',
      source_payment_id: PAYMENT_ID,
      source_event_id: 'evt_saved_method',
      created_at: NOW,
    }]);
    expect(db.mandates).toEqual([expect.objectContaining({
      mandate_record_id: 'mnd_' + 'm'.repeat(26),
      provider: 'hyperswitch',
      merchant_id: MERCHANT,
      customer_id: CUSTOMER,
      payment_method_id: 'pm_hyperswitch_test_123',
      source_payment_id: PAYMENT_ID,
      source_event_id: 'evt_saved_method',
      consent_accepted_at: NOW,
      consent_acceptance_type: 'online',
      consent_scope: 'OFF_SESSION_RECURRING',
      consent_terms_version: 'luckread-recurring-consent-v1',
      provider_mandate_id: 'mandate_hyperswitch_test_123',
      status: 'PENDING_PROVIDER_CONFIRMATION',
      version: 1,
      provider_updated_at: null,
      created_at: NOW,
      updated_at: NOW,
    })]);
    expect(JSON.stringify(db.savedMethods)).not.toContain('192.0.2.1');
    expect(JSON.stringify(db.mandates)).not.toContain('LuckRead test client');
    expect(JSON.stringify(db.mandates)).not.toContain(SECRET);
  });

  it('fails closed on an unbound or missing provider consent receipt', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db);
    const signed = await signedBody(bodyText('evt_no_consent'));
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );
    expect(applied.outcome).toBe('APPLIED');
    expect(db.savedMethods).toHaveLength(0);
    expect(db.mandates).toHaveLength(0);
  });

  it('does not persist a saved method or mandate when signed consent has an impossible timestamp', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db);
    const payload = JSON.parse(bodyText('evt_invalid_consent_timestamp', NOW, true)) as {
      content: { object: Record<string, unknown> };
    };
    const mandateData = payload.content.object.mandate_data as {
      customer_acceptance: { accepted_at: string };
    };
    mandateData.customer_acceptance.accepted_at = '2026-02-31T12:00:00.000Z';
    const signed = await signedBody(JSON.stringify(payload));
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );

    // The verified payment remains authoritative, but malformed consent must
    // never create reusable payment credentials or an off-session mandate.
    expect(applied).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED' });
    expect(db.payments[0]).toMatchObject({ status: 'succeeded' });
    expect(db.orders[0]).toMatchObject({ status: 'CONFIRMED' });
    expect(db.savedMethods).toHaveLength(0);
    expect(db.mandates).toHaveLength(0);
  });

  it('does not persist a token when signed provider consent belongs to another customer', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db);
    const payload = JSON.parse(bodyText('evt_foreign_consent', NOW, true)) as {
      content: { object: Record<string, unknown> };
    };
    payload.content.object.customer_id = 'user_foreign';
    const signed = await signedBody(JSON.stringify(payload));
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );
    expect(applied.outcome).toBe('APPLIED');
    expect(db.savedMethods).toHaveLength(0);
    expect(db.mandates).toHaveLength(0);
  });


  it('applies a signed mandate_active event only to the matching pending mandate and deduplicates it', async () => {
    const db = new MemoryPaymentD1();
    seedMandate(db);
    const signed = await signedBody(mandateBody('evt_mandate_active', 'mandate_active', 'active'));
    const applied = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );

    expect(applied).toMatchObject({ outcome: 'APPLIED', eventId: 'evt_mandate_active', state: 'APPLIED' });
    expect(db.mandates[0]).toMatchObject({
      status: 'ACTIVE',
      version: 2,
      provider_updated_at: NOW,
      updated_at: '2026-10-28T12:00:00.001Z',
    });
    expect(db.events[0]).toMatchObject({
      event_type: 'mandate_active',
      payment_id: null,
      state: 'APPLIED',
      outcome_code: 'MANDATE_STATUS_APPLIED',
    });

    const replay = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(LATER),
    );
    expect(replay).toMatchObject({ outcome: 'DUPLICATE', receiptId: applied.receiptId });
    expect(db.mandates[0]?.version).toBe(2);
    expect(db.events).toHaveLength(1);
  });

  it('revokes an active mandate with a newer signed provider event', async () => {
    const db = new MemoryPaymentD1();
    seedMandate(db, {
      status: 'ACTIVE',
      version: 2,
      provider_updated_at: '2026-10-28T11:59:00.000Z',
      updated_at: '2026-10-28T11:59:00.000Z',
    });
    const signed = await signedBody(mandateBody(
      'evt_mandate_revoked', 'mandate_revoked', 'revoked', NOW,
    ));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );
    expect(result).toMatchObject({ outcome: 'APPLIED', state: 'APPLIED' });
    expect(db.mandates[0]).toMatchObject({ status: 'REVOKED', version: 3, provider_updated_at: NOW });
  });

  it('never reactivates a revoked mandate on an out-of-order mandate_active event', async () => {
    const db = new MemoryPaymentD1();
    seedMandate(db, {
      status: 'REVOKED',
      version: 3,
      provider_updated_at: NOW,
      updated_at: NOW,
    });
    const signed = await signedBody(mandateBody(
      'evt_mandate_active_late', 'mandate_active', 'active', LATER,
    ));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(LATER),
    );
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' });
    expect(db.mandates[0]).toMatchObject({ status: 'REVOKED', version: 3, provider_updated_at: NOW });
    expect(db.events[0]?.outcome_code).toBe('MANDATE_STATUS_CAS_LOST_OR_OUT_OF_ORDER');
  });

  it('routes mismatched mandate status or an unknown local mandate to reconciliation, never activation', async () => {
    const db = new MemoryPaymentD1();
    seedMandate(db);
    const badStatus = await signedBody(mandateBody(
      'evt_mandate_bad_status', 'mandate_active', 'revoked', NOW,
    ));
    const rejected = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...badStatus, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(),
    );
    expect(rejected.state).toBe('RECONCILIATION_REQUIRED');
    expect(db.mandates[0]?.status).toBe('PENDING_PROVIDER_CONFIRMATION');

    const unknown = await signedBody(mandateBody(
      'evt_mandate_unknown', 'mandate_active', 'active', NOW,
      { mandate_id: 'mandate_unknown' },
    ));
    const needsReconciliation = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...unknown, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      { ...fixedDeps(LATER), createEventRowId: () => 'evtrow_mandate_unknown' },
    );
    expect(needsReconciliation.state).toBe('RECONCILIATION_REQUIRED');
    expect(db.mandates[0]?.status).toBe('PENDING_PROVIDER_CONFIRMATION');
  });

  it('does not apply stale mandate webhook timestamps', async () => {
    const db = new MemoryPaymentD1();
    seedMandate(db, {
      status: 'ACTIVE',
      version: 2,
      provider_updated_at: LATER,
      updated_at: LATER,
    });
    const signed = await signedBody(mandateBody(
      'evt_mandate_stale', 'mandate_revoked', 'revoked', NOW,
    ));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(LATER),
    );
    expect(result.state).toBe('RECONCILIATION_REQUIRED');
    expect(db.mandates[0]).toMatchObject({ status: 'ACTIVE', version: 2, provider_updated_at: LATER });
  });

  it('retains provider success but does not confirm a cancelled Order; event requires reconciliation', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db, { status: 'CANCELLED', version: 2, updated_at: LATER });
    seedPayment(db);
    const signed = await signedBody(bodyText('evt_success_cancelled_order'));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps('2026-10-28T12:00:02.000Z'),
    );

    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' });
    expect(db.payments[0]).toMatchObject({ status: 'succeeded', version: 2, provider_updated_at: NOW });
    expect(db.orders[0]).toMatchObject({ status: 'CANCELLED', version: 2, confirmed_at: null });
    expect(db.events[0]?.outcome_code).toBe('ORDER_CONFIRMATION_REQUIRED');
  });

  it('retains stale signed provider observations for reconciliation without regressing Payment state', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db, {
      status: 'processing',
      version: 3,
      provider_updated_at: '2026-10-28T12:00:05.000Z',
      updated_at: '2026-10-28T12:00:06.000Z',
    });
    const signed = await signedBody(bodyText('evt_stale', NOW));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps(LATER),
    );
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' });
    expect(db.payments[0]).toMatchObject({
      status: 'processing',
      version: 3,
      provider_updated_at: '2026-10-28T12:00:05.000Z',
    });
    expect(db.events[0]?.outcome_code).toBe('STALE_PROVIDER_TIMESTAMP');
  });

  it('does not reopen a terminal Payment even when a later signed event claims success', async () => {
    const db = new MemoryPaymentD1();
    seedOrder(db);
    seedPayment(db, {
      status: 'failed',
      version: 2,
      provider_updated_at: '2026-10-28T12:00:00.000Z',
      updated_at: '2026-10-28T12:00:01.000Z',
    });
    const signed = await signedBody(bodyText('evt_reopen', '2026-10-28T12:00:03.000Z'));
    const result = await receiveHyperswitchWebhook(
      db as unknown as D1Database,
      { ...signed, webhookSecret: SECRET, expectedMerchantId: MERCHANT },
      fixedDeps('2026-10-28T12:00:04.000Z'),
    );
    expect(result).toMatchObject({ outcome: 'RECONCILIATION_REQUIRED', state: 'RECONCILIATION_REQUIRED' });
    expect(db.payments[0]).toMatchObject({
      status: 'failed',
      version: 2,
      provider_updated_at: '2026-10-28T12:00:00.000Z',
    });
    expect(db.events[0]?.outcome_code).toBe('FORBIDDEN_PAYMENT_TRANSITION');
  });

  it('records a different payload for the same event id as a conflict without overwriting first receipt', async () => {
    const db = new MemoryPaymentD1();
    const signed1 = await signedBody(bodyText('evt_1', NOW));
    const first = await receiveHyperswitchWebhook(db as unknown as D1Database,
      { ...signed1, webhookSecret: SECRET, expectedMerchantId: MERCHANT }, fixedDeps());
    const signed2 = await signedBody(bodyText('evt_1', '2026-10-28T12:00:03.000Z'));
    const conflict = await receiveHyperswitchWebhook(db as unknown as D1Database,
      { ...signed2, webhookSecret: SECRET, expectedMerchantId: MERCHANT }, fixedDeps('2026-10-28T12:00:04.000Z'));
    const repeated = await receiveHyperswitchWebhook(db as unknown as D1Database,
      { ...signed2, webhookSecret: SECRET, expectedMerchantId: MERCHANT }, fixedDeps('2026-10-28T12:00:05.000Z'));
    expect(conflict).toMatchObject({ outcome: 'PAYLOAD_CONFLICT', eventId: 'evt_1', conflictId: expect.any(String) });
    expect(repeated.conflictId).toBe(conflict.conflictId);
    expect(db.events).toHaveLength(1);
    expect(db.events[0].payload_sha256).toBe(first.payloadSha256);
    expect(db.conflicts).toHaveLength(1);
    expect(db.conflicts[0].occurrence_count).toBe(2);
    expect(db.conflicts[0].version).toBe(2);
  });

  it('fails closed on invalid signature, malformed envelope, and merchant mismatch', async () => {
    const db = new MemoryPaymentD1();
    const signed = await signedBody(bodyText('evt_1'));
    await expectPaymentError(
      receiveHyperswitchWebhook(db as unknown as D1Database,
        { ...signed, signatureHeader: '0'.repeat(128), webhookSecret: SECRET, expectedMerchantId: MERCHANT }, fixedDeps()),
      'INVALID_SIGNATURE',
    );
    await expectPaymentError(
      receiveHyperswitchWebhook(db as unknown as D1Database,
        { ...signed, webhookSecret: SECRET, expectedMerchantId: 'another_merchant' }, fixedDeps()),
      'WEBHOOK_REJECTED',
    );
    const malformed = await signedBody('{"merchant_id":');
    await expectPaymentError(
      receiveHyperswitchWebhook(db as unknown as D1Database,
        { ...malformed, webhookSecret: SECRET, expectedMerchantId: MERCHANT }, fixedDeps()),
      'WEBHOOK_REJECTED',
    );
    expect(db.events).toHaveLength(0);
  });
});
