import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { betterAuthPayloadStrategy } from '@/auth/better-auth-payload-strategy'
import { payloadAdminOnly } from '@/auth/payload-admin-access'
import { invalidatePublicUsernameRedirect } from '@/lib/public-response-cache'
import {
  normalizeUsernameRedirectHandle,
  usernameRedirectFromPath,
  usernameRedirectTargetPath,
} from '@/lib/username-redirect'

type UsernameRedirectRecord = {
  sourceUsername?: string
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
    where: usernameHistoryKey(username),
    depth: 0,
    limit: 1,
    overrideAccess: true,
    req,
  })
  if (existing.docs.length > 0) throw new Error('LUCKREAD_USERNAME_RESERVED')
  return data
}

const recordUsernameHistory: CollectionAfterChangeHook = async ({
  doc,
  operation,
  previousDoc,
  req,
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

  const redirectPayload = redirectAPI(req.payload)
  const identityWhere = {
    and: [
      { identityId: { equals: identityId } },
      { redirectScope: { equals: 'username' } },
    ],
  }
  const history = await redirectPayload.find({
    collection: 'redirects',
    where: identityWhere,
    depth: 0,
    limit: 1000,
    pagination: false,
    overrideAccess: true,
    req,
  })
  if (
    history.docs.length >= 1000 ||
    (history.totalDocs !== undefined && history.totalDocs > history.docs.length)
  ) throw new Error('LUCKREAD_USERNAME_HISTORY_LIMIT_EXCEEDED')

  const destinationPath = usernameRedirectTargetPath(currentUsername)
  if (history.docs.length > 0) {
    await redirectPayload.update({
      collection: 'redirects',
      where: identityWhere,
      data: {
        to: { type: 'custom', url: destinationPath },
        destinationUsername: currentUsername,
      },
      depth: 0,
      overrideAccess: true,
      req,
    })
  }
  await redirectPayload.create({
    collection: 'redirects',
    data: {
      from: usernameRedirectFromPath(previousUsername),
      to: { type: 'custom', url: destinationPath },
      type: '301',
      redirectScope: 'username',
      identityId,
      sourceUsername: previousUsername,
      destinationUsername: currentUsername,
    },
    depth: 0,
    overrideAccess: true,
    req,
  })

  const usernamesToInvalidate = new Set<string>([
    previousUsername,
    currentUsername,
    ...history.docs
      .map((record) => record.sourceUsername)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  ])
  await Promise.all([...usernamesToInvalidate].map(invalidatePublicUsernameRedirect))
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
      validate: (value) => normalizeUsernameRedirectHandle(value) ? true : 'Invalid username',
    },
    { name: 'displayName', type: 'text' },
    { name: 'bio', type: 'textarea' },
    { name: 'avatar', type: 'text' },
    { name: 'locale', type: 'text', defaultValue: 'en-US' },
    { name: 'timezone', type: 'text', defaultValue: 'UTC' },
  ],
  versions: false,
}
