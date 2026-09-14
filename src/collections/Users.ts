import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { type AuthorizationUser } from '../lib/authorization'
import {
  ACCOUNT_STATES,
  assertAccountRestoreWindow,
  assertAccountStateActor,
  resolveAccountStateTransition,
  type AccountState,
} from '../lib/account-state-machine'

function authorizationUser(value: unknown): AuthorizationUser | null {
  if (!value || typeof value !== 'object') return null
  return value as AuthorizationUser
}

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email' },
  auth: true,
  access: {
    update: ({ req }) => Boolean(req.user),
  },
  endpoints: [{
    path: '/:id/state',
    method: 'post',
    handler: async (req) => {
      if (!req.user) throw new APIError('Authentication required', 401)
      const id = String(req.routeParams.id)
      const body = (await req.json()) as { to?: AccountState; expectedStateVersion?: number }
      if (!body.to || !ACCOUNT_STATES.includes(body.to)) throw new APIError('A valid target account state is required', 400)
      if (!Number.isInteger(body.expectedStateVersion) || body.expectedStateVersion < 1) throw new APIError('expectedStateVersion is required for optimistic concurrency', 400)

      const current = await req.payload.findByID({ collection: 'users', id, depth: 0, overrideAccess: true, req })
      const from = current.accountState as AccountState
      const transition = resolveAccountStateTransition(from, body.to)
      const user = authorizationUser(req.user)
      assertAccountStateActor({ transition, user, targetUserId: id })

      if (Number(current.accountStateVersion) !== body.expectedStateVersion) {
        throw new APIError('Account state version conflict; reload and retry', 409)
      }

      if (transition.precondition === 'phone_or_email_verified' && !current.emailVerifiedAt && !current.phoneVerifiedAt) {
        throw new APIError('Phone or email verification is required', 409)
      }
      if (transition.precondition === 'restore_window') assertAccountRestoreWindow(current.deletedAt)
      if (transition.precondition === 'cooling_off_started' && !current.deletionRequestedAt) {
        throw new APIError('Deletion request timestamp is required before entering the cooling-off period', 409)
      }

      const now = new Date().toISOString()
      const nextVersion = Number(current.accountStateVersion) + 1
      const data: Record<string, unknown> = { accountState: body.to, accountStateVersion: nextVersion }
      if (body.to === 'DELETION_REQUESTED') data.deletionRequestedAt = now
      if (body.to === 'DELETION_PENDING') data.deletionPendingAt = now
      if (body.to === 'DELETED') data.deletedAt = now
      if (body.to === 'RESTORED' || body.to === 'REACTIVATED') data.deletedAt = null

      const result = await req.payload.update({
        collection: 'users',
        where: {
          and: [
            { id: { equals: id } },
            { accountState: { equals: from } },
            { accountStateVersion: { equals: body.expectedStateVersion } },
          ],
        },
        data,
        overrideAccess: true,
        req,
      })
      if (result.docs.length !== 1) throw new APIError('Account state version conflict; reload and retry', 409)

      const event = await req.payload.create({
        collection: 'account-state-events',
        data: {
          eventId: randomUUID(),
          user: id,
          fromState: from,
          toState: body.to,
          actorId: String(user?.id),
          actorType: transition.actor,
          permission: transition.permission ?? 'self-service',
          version: nextVersion,
          precondition: transition.precondition ?? null,
        },
        overrideAccess: true,
        req,
      })

      return Response.json({ data: result.docs[0], eventId: event.eventId, transition })
    },
    custom: {
      openapi: {
        summary: 'Transition account lifecycle state',
        responses: {
          200: { description: 'Account state transitioned' },
          400: { description: 'Invalid transition request' },
          401: { description: 'Authentication required' },
          403: { description: 'Permission denied' },
          409: { description: 'Invalid lifecycle transition or optimistic concurrency conflict' },
        },
      },
    },
  }],
  fields: [
    { name: 'role', type: 'select', required: true, defaultValue: 'user', options: ['user', 'verified_user', 'creator', 'ip_principal', 'mcn_admin', 'mcn_editor', 'editor', 'operator', 'moderator', 'admin', 'super_admin'].map((value) => ({ label: value, value })), index: true },
    { name: 'accountState', type: 'select', required: true, defaultValue: 'PENDING_VERIFICATION', options: ACCOUNT_STATES.map((value) => ({ label: value, value })), index: true },
    { name: 'accountStateVersion', type: 'number', required: true, defaultValue: 1, min: 1, index: true },
    { name: 'emailVerifiedAt', type: 'date' },
    { name: 'phoneVerifiedAt', type: 'date' },
    { name: 'deletionRequestedAt', type: 'date' },
    { name: 'deletionPendingAt', type: 'date' },
    { name: 'deletedAt', type: 'date' },
    { name: 'permissions', type: 'json' },
    { name: 'entitlements', type: 'json' },
    { name: 'organizationScopes', type: 'json' },
  ],
  versions: false,
}
