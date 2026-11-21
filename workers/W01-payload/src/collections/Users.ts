import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { betterAuthPayloadStrategy } from '@/auth/better-auth-payload-strategy'
import { payloadAdminOnly } from '@/auth/payload-admin-access'
import { callW03Content } from '@/content/w03-content-client'
import {
  normalizeUsernameRedirectHandle,
  isUsernameRedirectActive,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
  usernameRedirectExpiresAt,
} from '@/lib/username-redirect'

type UsernameRedirectRecord = {
  identityId?: string
  sourceUsername?: string
  expiresAt?: string
}

type UsernameRedirectAPI = {
  find: (args: {
    collection: 'redirects'
    where: Record<string, unknown>
    depth: 0
    limit: number
    pagination?: boolean
    overrideAccess: true
    req: unknown
  }) => Promise<{ docs: UsernameRedirectRecord[]; totalDocs?: number }>
  create: (args: {
    collection: 'redirects'
    data: Record<string, unknown>
    depth: 0
    overrideAccess: true
    req: unknown
  }) => Promise<unknown>
  update: (args: {
    collection: 'redirects'
    where: Record<string, unknown>
    data: Record<string, unknown>
    depth: 0
    overrideAccess: true
    req: unknown
  }) => Promise<unknown>
}

const redirectAPI = (payload: unknown): UsernameRedirectAPI =>
  payload as UsernameRedirectAPI

const usernameHistoryKey = (username: string) => ({
  and: [
    { from: { equals: usernameRedirectFromPath(username) } },
    { redirectScope: { equals: 'username' } },
  ],
})

const activeIdentityHistoryKey = (identityId: string, now: string) => ({
  and: [
    { identityId: { equals: identityId } },
    { redirectScope: { equals: 'username' } },
    { expiresAt: { greater_than: now } },
  ],
})

const reserveHistoricalUsername: CollectionBeforeChangeHook = async ({
  data,
  operation,
  originalDoc,
  req,
}) => {
  const requestedValue = data?.username
  if (requestedValue === undefined && operation === 'update') return data

  const username = normalizeUsernameRedirectHandle(requestedValue)
  if (!username) throw new Error('LUCKREAD_USERNAME_INVALID')

  const previousUsername = normalizeUsernameRedirectHandle(originalDoc?.username)
  if (operation === 'update' && previousUsername === username) return data

  if (
    operation === 'update' &&
    previousUsername &&
    usernameRedirectFromPath(previousUsername) === usernameRedirectFromPath(username)
  ) {
    throw new Error('LUCKREAD_USERNAME_CASE_ONLY_CHANGE')
  }

  const existing = await redirectAPI(req.payload).find({
    collection: 'redirects',
    where: {
      and: [
        ...usernameHistoryKey(username).and,
        { expiresAt: { greater_than: new Date().toISOString() } },
      ],
    },
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (existing.docs.length > 0) throw new Error('LUCKREAD_USERNAME_RESERVED')
  return data
}

const recordUsernameHistory: CollectionAfterChangeHook = async ({
  doc, operation, previousDoc, req,
}) => {
  if (operation !== 'update') return doc
  const previousUsername = normalizeUsernameRedirectHandle(previousDoc?.username)
  const currentUsername = normalizeUsernameRedirectHandle(doc.username)
  if (!previousUsername || !currentUsername || previousUsername === currentUsername) return doc
  if (usernameRedirectFromPath(previousUsername) === usernameRedirectFromPath(currentUsername)) {
    throw new Error('LUCKREAD_USERNAME_CASE_ONLY_CHANGE')
  }
  const identityId = typeof doc.identityId === 'string' ? doc.identityId.trim() : ''
  if (!identityId) throw new Error('LUCKREAD_USERNAME_IDENTITY_MISSING')
  const now = new Date()
  const nowIso = now.toISOString()
  const redirectPayload = redirectAPI(req.payload)
  const identityWhere = activeIdentityHistoryKey(identityId, nowIso)
  const history = await redirectPayload.find({
    collection: 'redirects', where: identityWhere, depth: 0, limit: 1000,
    pagination: false, overrideAccess: true, req,
  })
  if (history.docs.length >= 1000 || (history.totalDocs !== undefined && history.totalDocs > history.docs.length)) {
    throw new Error('LUCKREAD_USERNAME_HISTORY_LIMIT_EXCEEDED')
  }
  // W03/D1-02 alone decides whether the account has published public content.
  const eligibilityRequest = new Request('https://luckread.com/internal/username-redirect-eligibility', {
    method: 'GET', headers: req.headers,
  })
  const eligibilityResponse = await callW03Content({
    request: eligibilityRequest,
    pathname: '/internal/content/username-redirect-eligibility/' + encodeURIComponent(identityId),
    method: 'GET',
  })
  if (!eligibilityResponse.ok) throw new Error('LUCKREAD_USERNAME_REDIRECT_ELIGIBILITY_UNAVAILABLE')
  let eligibilityEnvelope: unknown
  try { eligibilityEnvelope = await eligibilityResponse.json() } catch { eligibilityEnvelope = null }
  const eligibilityData = eligibilityEnvelope && typeof eligibilityEnvelope === 'object' && !Array.isArray(eligibilityEnvelope)
    ? (eligibilityEnvelope as { data?: unknown }).data
    : null
  if (!eligibilityData || typeof eligibilityData !== 'object' || Array.isArray(eligibilityData) ||
      typeof (eligibilityData as { eligible?: unknown }).eligible !== 'boolean') {
    throw new Error('LUCKREAD_USERNAME_REDIRECT_ELIGIBILITY_INVALID')
  }
  const eligible = (eligibilityData as { eligible: boolean }).eligible
  const destinationPath = usernameRedirectTargetPath(currentUsername)
  // Retarget only active history. Its original expiry is intentionally unchanged.
  if (history.docs.length > 0) {
    await redirectPayload.update({
      collection: 'redirects', where: identityWhere,
      data: { to: { type: 'custom', url: destinationPath }, destinationUsername: currentUsername },
      depth: 0, overrideAccess: true, req,
    })
  }
  // No published public content means no new username 301.
  if (eligible) {
    const sourceWhere = usernameHistoryKey(previousUsername)
    const sourceResult = await redirectPayload.find({
      collection: 'redirects', where: sourceWhere, depth: 0, limit: 1,
      overrideAccess: true, req,
    })
    const existing = sourceResult.docs[0]
    const active = isUsernameRedirectActive(existing?.expiresAt, now)
    if (active && existing?.identityId !== identityId) throw new Error('LUCKREAD_USERNAME_RESERVED')
    const expiresAt = active && typeof existing?.expiresAt === 'string'
      ? existing.expiresAt
      : usernameRedirectExpiresAt(now)
    const redirectData = {
      from: usernameRedirectFromPath(previousUsername),
      to: { type: 'custom', url: destinationPath },
      type: '301', redirectScope: 'username', identityId,
      sourceUsername: previousUsername, destinationUsername: currentUsername, expiresAt,
    }
    if (existing) {
      // Payload's `from` is unique: reclaim the expired row in place.
      await redirectPayload.update({ collection: 'redirects', where: sourceWhere, data: redirectData, depth: 0, overrideAccess: true, req })
    } else {
      await redirectPayload.create({ collection: 'redirects', data: redirectData, depth: 0, overrideAccess: true, req })
    }
  }
  return doc
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: {
    disableLocalStrategy: {
      enableFields: true,
      optionalPassword: true,
    },
    strategies: [betterAuthPayloadStrategy],
  },
  access: {
    create: () => false,
    read: payloadAdminOnly,
    update: payloadAdminOnly,
    delete: payloadAdminOnly,
    admin: payloadAdminOnly,
  },
  hooks: {
    beforeChange: [reserveHistoricalUsername],
    afterChange: [recordUsernameHistory],
  },
  fields: [
    { name: 'identityId', type: 'text', required: false, unique: true, index: true, admin: { readOnly: true } },
    {
      name: 'username',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      validate: (value: unknown) => normalizeUsernameRedirectHandle(value) ? true : 'Invalid username',
    },
    { name: 'displayName', type: 'text' },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'text' },
    { name: 'locale', type: 'text', defaultValue: 'en-US' },
    { name: 'timezone', type: 'text', defaultValue: 'UTC' },
  ],
  versions: false,
}
