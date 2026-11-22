import { apiRequest } from './api-client';

export type CreatorApplication = {
  application_id: string;
  creator_type: string;
  statement: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  grant_state: string;
  created_at: string;
  updated_at: string;
  decided_at?: string | null;
  decision_reason?: string | null;
  version: number;
};
export type CreatorPlan = {
  planId: string; creatorId: string; planVersion: number; name: string; tier: string;
  billingInterval: 'MONTHLY' | 'YEARLY'; priceMinor: number; currency: string;
  benefits: string[]; status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'RETIRED';
  visibility: 'PRIVATE' | 'PUBLIC'; version: number; etag: string;
  createdAt: string; updatedAt: string;
};
export type CreatorPlanTerms = {
  name: string; tier: string; billingInterval: 'MONTHLY' | 'YEARLY';
  priceMinor: number; currency: string; benefits: string[];
};
const idPattern = /^plan_[a-f0-9]{64}$/;
const keyPattern = /^[A-Za-z0-9_-]{1,128}$/;
function validKey(key: string) { if (!keyPattern.test(key)) throw new TypeError('A valid idempotency key is required.'); }
function validId(id: string) { if (!idPattern.test(id)) throw new TypeError('Membership plan ID is invalid.'); }
function validEtag(etag: string) { if (!/^"lr-plan-v[1-9][0-9]*"$/.test(etag)) throw new TypeError('A current membership plan ETag is required.'); }
function validTerms(t: CreatorPlanTerms) {
  if (!t || typeof t.name !== 'string' || t.name.trim() !== t.name || !t.name.length || t.name.length > 120 ||
      typeof t.tier !== 'string' || !/^[a-z][a-z0-9_-]{0,63}$/.test(t.tier) ||
      !['MONTHLY', 'YEARLY'].includes(t.billingInterval) ||
      !Number.isSafeInteger(t.priceMinor) || t.priceMinor < 0 || t.priceMinor > 2147483647 ||
      !/^[A-Z]{3}$/.test(t.currency) || !Array.isArray(t.benefits) || t.benefits.length > 20 ||
      !t.benefits.every(x => typeof x === 'string' && x.trim() === x && x.length > 0 && x.length <= 180) ||
      new Set(t.benefits).size !== t.benefits.length) throw new TypeError('Membership plan terms are invalid.');
}
export function fetchMyCreatorApplication(options: { signal?: AbortSignal } = {}) {
  return apiRequest<unknown>('/creator-applications', { method: 'GET', signal: options.signal });
}
export function submitCreatorApplication(creatorType: string, statement: string, idempotencyKey: string) {
  if (!['PERSONAL', 'WRITER', 'VIDEO_CREATOR', 'DEVELOPER', 'ARTIST', 'OTHER'].includes(creatorType)) throw new TypeError('Creator type is invalid.');
  if (typeof statement !== 'string' || statement.trim() !== statement || statement.length > 2000) throw new TypeError('Creator application statement is invalid.');
  validKey(idempotencyKey);
  return apiRequest<unknown>('/creator-applications', { method: 'POST', idempotencyKey, body: JSON.stringify({ creatorType, statement }) });
}
export function fetchMyCreatorPlans(options: { limit?: number; cursor?: string | null; signal?: AbortSignal } = {}) {
  const limit = options.limit ?? 50;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new RangeError('Creator plan page size must be between 1 and 50.');
  const query = new URLSearchParams({ limit: String(limit) });
  if (options.cursor) query.set('cursor', options.cursor);
  return apiRequest<unknown>('/membership/plans?' + query.toString(), { method: 'GET', signal: options.signal });
}
export function createMyCreatorPlan(terms: CreatorPlanTerms, idempotencyKey: string) {
  validTerms(terms); validKey(idempotencyKey);
  return apiRequest<unknown>('/membership/plans', { method: 'POST', idempotencyKey, body: JSON.stringify({ ...terms, trialPeriodDays: 0 }) });
}
export function updateMyCreatorPlan(planId: string, etag: string, terms: CreatorPlanTerms, idempotencyKey: string) {
  validId(planId); validEtag(etag); validTerms(terms); validKey(idempotencyKey);
  return apiRequest<unknown>('/membership/plans/' + encodeURIComponent(planId), { method: 'PUT', headers: { 'If-Match': etag }, idempotencyKey, body: JSON.stringify(terms) });
}
export function publishMyCreatorPlan(planId: string, etag: string) {
  validId(planId); validEtag(etag);
  return apiRequest<unknown>('/membership/plans/' + encodeURIComponent(planId) + '/publish', { method: 'POST', headers: { 'If-Match': etag } });
}
export function changeMyCreatorPlanLifecycle(planId: string, etag: string, action: 'pause' | 'resume' | 'retire') {
  validId(planId); validEtag(etag);
  return apiRequest<unknown>('/membership/plans/' + encodeURIComponent(planId) + '/lifecycle', { method: 'POST', headers: { 'If-Match': etag }, body: JSON.stringify({ action }) });
}
