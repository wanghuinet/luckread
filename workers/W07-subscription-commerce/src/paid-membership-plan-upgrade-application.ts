/// <reference types="@cloudflare/workers-types" />

import { sha256BytesToHex } from '../../W10-async/src/canonical-json-idempotency.js';

type ApplicationRow = Readonly<{
  application_id: string;
  subscription_id: string;
  subscriber_id: string;
  source_plan_id: string;
  source_plan_version: number;
  target_plan_id: string;
  target_plan_version: number;
  expected_subscription_version: number;
  current_period_start: string;
  current_period_end: string;
  order_id: string;
  payment_id: string;
  amount_minor: number;
  currency: string;
  request_hash: string;
  status: 'READY' | 'APPLIED';
}>;

type SubscriptionRow = Readonly<{
  subscription_id: string;
  subscriber_id: string;
  plan_id: string;
  plan_version: number;
  status: string;
  current_period_start: string;
  current_period_end: string;
  cancel_at: string | null;
  updated_at: string;
  version: number;
}>;

export type PaidMembershipUpgradeApplicationInput = Readonly<{
  subscriptionId: string;
  subscriberId: string;
  sourcePlanId: string;
  sourcePlanVersion: number;
  targetPlanId: string;
  targetPlanVersion: number;
  expectedSubscriptionVersion: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  orderId: string;
  paymentId: string;
  amountMinor: number;
  currency: string;
  requestHash: string;
  confirmedAt: string;
}>;

export type PaidMembershipUpgradeApplicationOutcome = 'APPLIED' | 'ALREADY_APPLIED';

export class PaidMembershipUpgradeApplicationError extends Error {
  constructor() {
    super('Paid membership upgrade could not be applied safely');
    this.name = 'PaidMembershipUpgradeApplicationError';
  }
}

const PLAN_ID = /^plan_[a-f0-9]{64}$/;
const PAYMENT_ID = /^pay_[A-Za-z0-9]{26}$/;
const APPLICATION_ID = /^spa_[A-Za-z0-9]{26}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalUtc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function validateInput(value: PaidMembershipUpgradeApplicationInput): void {
  if (!validId(value.subscriptionId) || !validId(value.subscriberId) ||
      !PLAN_ID.test(value.sourcePlanId) || !PLAN_ID.test(value.targetPlanId) ||
      (value.sourcePlanId === value.targetPlanId && value.sourcePlanVersion === value.targetPlanVersion) ||
      !Number.isSafeInteger(value.sourcePlanVersion) || value.sourcePlanVersion < 1 ||
      !Number.isSafeInteger(value.targetPlanVersion) || value.targetPlanVersion < 1 ||
      !Number.isSafeInteger(value.expectedSubscriptionVersion) || value.expectedSubscriptionVersion < 1 ||
      !canonicalUtc(value.currentPeriodStart) || !canonicalUtc(value.currentPeriodEnd) ||
      Date.parse(value.currentPeriodEnd) <= Date.parse(value.currentPeriodStart) ||
      !validId(value.orderId, 255) || !PAYMENT_ID.test(value.paymentId) ||
      !Number.isSafeInteger(value.amountMinor) || value.amountMinor < 1 ||
      !/^[A-Z]{3}$/.test(value.currency) || !SHA256.test(value.requestHash) ||
      !canonicalUtc(value.confirmedAt) ||
      Date.parse(value.confirmedAt) < Date.parse(value.currentPeriodStart) ||
      Date.parse(value.confirmedAt) >= Date.parse(value.currentPeriodEnd)) {
    throw new PaidMembershipUpgradeApplicationError();
  }
}

function matchesApplication(row: ApplicationRow, input: PaidMembershipUpgradeApplicationInput): boolean {
  return row.subscription_id === input.subscriptionId &&
    row.subscriber_id === input.subscriberId &&
    row.source_plan_id === input.sourcePlanId &&
    row.source_plan_version === input.sourcePlanVersion &&
    row.target_plan_id === input.targetPlanId &&
    row.target_plan_version === input.targetPlanVersion &&
    row.expected_subscription_version === input.expectedSubscriptionVersion &&
    row.current_period_start === input.currentPeriodStart &&
    row.current_period_end === input.currentPeriodEnd &&
    row.order_id === input.orderId &&
    row.payment_id === input.paymentId &&
    row.amount_minor === input.amountMinor &&
    row.currency === input.currency &&
    row.request_hash === input.requestHash;
}

async function applicationIdForOrderLine(orderId: string, lineId: string): Promise<string> {
  const digest = await sha256BytesToHex(new TextEncoder().encode(
    'paid-membership-plan-upgrade-v1\u0000' + orderId + '\u0000' + lineId,
  ));
  const id = 'spa_' + digest.slice(0, 26);
  if (!APPLICATION_ID.test(id)) throw new PaidMembershipUpgradeApplicationError();
  return id;
}

function monotonicTimestamp(now: string, previous: string): string {
  const candidate = Date.parse(now);
  const prior = Date.parse(previous);
  if (!Number.isFinite(candidate) || !Number.isFinite(prior)) throw new PaidMembershipUpgradeApplicationError();
  return new Date(Math.max(candidate, prior + 1)).toISOString();
}

/**
 * Applies a same-cycle plan upgrade only after the webhook receiver has verified
 * the Hyperswitch signature and durably confirmed the paid D1-04 Order/Payment.
 * D1-01 records a one-use application proof and performs the subscription CAS in
 * the same database transaction; the migration triggers reject direct plan writes.
 */
export async function applyPaidMembershipPlanUpgrade(
  db: D1Database,
  input: PaidMembershipUpgradeApplicationInput,
  orderLineId: string,
): Promise<PaidMembershipUpgradeApplicationOutcome> {
  validateInput(input);
  if (!validId(orderLineId, 255)) throw new PaidMembershipUpgradeApplicationError();

  let existing: ApplicationRow | null;
  try {
    existing = await db.prepare(
      'SELECT application_id, subscription_id, subscriber_id, source_plan_id, source_plan_version, ' +
      'target_plan_id, target_plan_version, expected_subscription_version, current_period_start, ' +
      'current_period_end, order_id, payment_id, amount_minor, currency, request_hash, status ' +
      'FROM membership_subscription_plan_change_applications WHERE order_id = ? OR payment_id = ? LIMIT 1',
    ).bind(input.orderId, input.paymentId).first<ApplicationRow>();
  } catch {
    throw new PaidMembershipUpgradeApplicationError();
  }
  if (existing) {
    if (!matchesApplication(existing, input) || existing.status !== 'APPLIED') {
      throw new PaidMembershipUpgradeApplicationError();
    }
    return 'ALREADY_APPLIED';
  }

  let subscription: SubscriptionRow | null;
  try {
    subscription = await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, status, current_period_start, ' +
      'current_period_end, cancel_at, updated_at, version FROM membership_subscriptions ' +
      'WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(input.subscriptionId, input.subscriberId).first<SubscriptionRow>();
  } catch {
    throw new PaidMembershipUpgradeApplicationError();
  }
  if (!subscription || subscription.subscription_id !== input.subscriptionId ||
      subscription.subscriber_id !== input.subscriberId ||
      subscription.plan_id !== input.sourcePlanId ||
      subscription.plan_version !== input.sourcePlanVersion ||
      subscription.status !== 'ACTIVE' || subscription.cancel_at !== null ||
      subscription.version !== input.expectedSubscriptionVersion ||
      subscription.current_period_start !== input.currentPeriodStart ||
      subscription.current_period_end !== input.currentPeriodEnd ||
      !canonicalUtc(subscription.updated_at)) {
    throw new PaidMembershipUpgradeApplicationError();
  }

  const applicationId = await applicationIdForOrderLine(input.orderId, orderLineId);
  const updatedAt = monotonicTimestamp(input.confirmedAt, subscription.updated_at);
  let results: D1Result[];
  try {
    results = await db.batch([
      db.prepare(
        'INSERT INTO membership_subscription_plan_change_applications ' +
        '(application_id, subscription_id, subscriber_id, source_plan_id, source_plan_version, ' +
        'target_plan_id, target_plan_version, expected_subscription_version, current_period_start, ' +
        'current_period_end, order_id, payment_id, amount_minor, currency, request_hash, status, version, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'READY', 1, ?, ?)",
      ).bind(
        applicationId, input.subscriptionId, input.subscriberId, input.sourcePlanId, input.sourcePlanVersion,
        input.targetPlanId, input.targetPlanVersion, input.expectedSubscriptionVersion,
        input.currentPeriodStart, input.currentPeriodEnd, input.orderId, input.paymentId,
        input.amountMinor, input.currency, input.requestHash, input.confirmedAt, input.confirmedAt,
      ),
      db.prepare(
        'UPDATE membership_subscriptions SET plan_id = ?, plan_version = ?, updated_at = ?, version = version + 1 ' +
        'WHERE subscription_id = ? AND subscriber_id = ? AND plan_id = ? AND plan_version = ? ' +
        "AND status = 'ACTIVE' AND cancel_at IS NULL AND version = ? " +
        'AND current_period_start = ? AND current_period_end = ?',
      ).bind(
        input.targetPlanId, input.targetPlanVersion, updatedAt,
        input.subscriptionId, input.subscriberId, input.sourcePlanId, input.sourcePlanVersion,
        input.expectedSubscriptionVersion, input.currentPeriodStart, input.currentPeriodEnd,
      ),
    ]);
  } catch {
    throw new PaidMembershipUpgradeApplicationError();
  }

  if (results.length !== 2 || Number(results[0]?.meta?.changes ?? 0) !== 1 ||
      Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new PaidMembershipUpgradeApplicationError();
  }

  let applied: ApplicationRow | null;
  let latest: SubscriptionRow | null;
  try {
    applied = await db.prepare(
      'SELECT application_id, subscription_id, subscriber_id, source_plan_id, source_plan_version, ' +
      'target_plan_id, target_plan_version, expected_subscription_version, current_period_start, ' +
      'current_period_end, order_id, payment_id, amount_minor, currency, request_hash, status ' +
      'FROM membership_subscription_plan_change_applications WHERE application_id = ? LIMIT 1',
    ).bind(applicationId).first<ApplicationRow>();
    latest = await db.prepare(
      'SELECT subscription_id, subscriber_id, plan_id, plan_version, status, current_period_start, ' +
      'current_period_end, cancel_at, updated_at, version FROM membership_subscriptions ' +
      'WHERE subscription_id = ? AND subscriber_id = ? LIMIT 1',
    ).bind(input.subscriptionId, input.subscriberId).first<SubscriptionRow>();
  } catch {
    throw new PaidMembershipUpgradeApplicationError();
  }
  if (!applied || !matchesApplication(applied, input) || applied.status !== 'APPLIED' ||
      !latest || latest.plan_id !== input.targetPlanId || latest.plan_version !== input.targetPlanVersion ||
      latest.version !== input.expectedSubscriptionVersion + 1 ||
      latest.current_period_start !== input.currentPeriodStart ||
      latest.current_period_end !== input.currentPeriodEnd) {
    throw new PaidMembershipUpgradeApplicationError();
  }
  return 'APPLIED';
}
