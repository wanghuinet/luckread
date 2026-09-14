import { randomUUID } from 'node:crypto'
import { APIError } from 'payload'
import type { CollectionConfig } from 'payload'

import { hasMaterialContentEdit } from '../lib/content-state-machine'
import { hasPermission, type AuthorizationUser } from '../lib/authorization'
import { transitionContentState } from '../lib/content-transition-service'
import { rollbackContent } from '../lib/content-rollback-service'
import { generateContentPaywall, readContentBody } from '../lib/content-paywall-service'

const contentTypes = ['article', 'post', 'video_metadata', 'gallery', 'live_metadata', 'series'] as const
const contentStates = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const
const paywallModes = ['FREE', 'SUBSCRIPTION_PREVIEW'] as const

function relationshipId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id
    return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined
  }
  return undefined
}
function canModerate(user: unknown): boolean { return hasPermission(user as AuthorizationUser | null, 'moderation.decide') }

export const Content: CollectionConfig = {
  slug: 'content',
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'contentType', 'state', 'author', 'ip', 'updatedAt'] },
  access: {
    read: ({ req }) => (req.user ? true : { state: { equals: 'PUBLISHED' } }),
    create: ({ req }) => Boolean(req.user) && hasPermission(req.user as AuthorizationUser, 'content.create.own'),
    update: ({ req }) => Boolean(req.user) && (hasPermission(req.user as AuthorizationUser, 'content.update.own') || canModerate(req.user)),
    delete: ({ req }) => Boolean(req.user) && (hasPermission(req.user as AuthorizationUser, 'content.delete.own') || canModerate(req.user)),
  },
  hooks: {
    beforeChange: [
      ({ data, originalDoc, req }) => {
        if (!req.user) throw new APIError('Authentication required', 401)
        const actorId = String(req.user.id)
        const isModerator = canModerate(req.user)
        if (!originalDoc) {
          const authorId = relationshipId(data.author)
          if (!authorId) throw new APIError('Content author is required', 400)
          if (!isModerator && authorId !== actorId) throw new APIError('Content author must match the authenticated user', 403)
        } else {
          const ownerId = relationshipId(originalDoc.author)
          if (!isModerator && ownerId !== actorId) throw new APIError('Content ownership permission denied', 403)
          if (data.author !== undefined && relationshipId(data.author) !== ownerId) throw new APIError('Content author is immutable', 400)
        }
        if (originalDoc && data.state !== undefined && data.state !== originalDoc.state && !req.context?.allowContentStateTransition) throw new APIError('Content state must be changed through the lifecycle transition API', 400)
        if (originalDoc?.state === 'PUBLISHED' && hasMaterialContentEdit(data as Record<string, unknown>, originalDoc as Record<string, unknown>)) throw new APIError('Material edits to published content require PUBLISHED -> PENDING_REVIEW before editing', 409)
        if (originalDoc?.state === 'DELETED' && data.state !== 'RESTORED' && data.state !== undefined) throw new APIError('Deleted content can only be restored through the lifecycle API', 409)
        if (req.context?.systemJob && !req.context.allowContentStateTransition) throw new APIError('System job context cannot mutate content directly', 403)
        if (data.paywallMode === 'SUBSCRIPTION_PREVIEW') {
          const previewPercent = Number(data.paywallPreviewPercent)
          if (!Number.isFinite(previewPercent) || previewPercent <= 0 || previewPercent >= 100) throw new APIError('paywallPreviewPercent must be between 1 and 99', 400)
          if (!data.paywallEntitlementCode) throw new APIError('paywallEntitlementCode is required for subscription content', 400)
          if (originalDoc?.state !== 'PUBLISHED' && (!data.previewBodyR2Key || !data.premiumBodyR2Key)) {
            // Keys are generated automatically when the content is published.
          }
        }
        if (data.paywallMode === 'FREE') {
          data.paywallEntitlementCode = undefined
          data.previewBodyR2Key = undefined
          data.premiumBodyR2Key = undefined
          data.paywallPreviewPercent = undefined
        }
        return data
      },
    ],
    afterChange: [
      async ({ doc, operation, req }) => {
        const actorId = req.user ? String(req.user.id) : String(relationshipId(doc.author))
        await req.payload.create({ collection: 'content-revisions', data: { revisionId: randomUUID(), content: String(doc.id), revision: Number(doc.revision), version: Number(doc.version), author: String(relationshipId(doc.author)), state: String(doc.state), snapshot: { title: doc.title, slug: doc.slug, contentType: doc.contentType, locale: doc.locale, excerpt: doc.excerpt, bodyR2Key: doc.bodyR2Key, coverMedia: doc.coverMedia, state: doc.state, paywallMode: doc.paywallMode, paywallPreviewPercent: doc.paywallPreviewPercent, paywallEntitlementCode: doc.paywallEntitlementCode, previewBodyR2Key: doc.previewBodyR2Key, premiumBodyR2Key: doc.premiumBodyR2Key }, changeReason: operation, createdBy: actorId }, overrideAccess: true, req })
      },
    ],
  },
  endpoints: [
    { path: '/:id/state', method: 'post', handler: async (req) => { const body = (await req.json()) as { to?: (typeof contentStates)[number]; expectedVersion?: number; expectedRevision?: number }; if (!body.to || !contentStates.includes(body.to)) throw new APIError('A valid target state is required', 400); return transitionContentState(req, body.to, body) }, custom: { openapi: { summary: 'Transition content lifecycle state' } } },
    { path: '/:id/rollback', method: 'post', handler: async (req) => { const body = (await req.json()) as { revision: number; expectedVersion: number; expectedRevision: number }; return rollbackContent(req, body) }, custom: { openapi: { summary: 'Rollback content to an immutable prior revision' } } },
    { path: '/:id/read', method: 'get', handler: async (req) => {
      const content = await req.payload.findByID({ collection: 'content', id: String(req.routeParams?.id ?? ''), depth: 0, overrideAccess: true, req })
      if (content.state !== 'PUBLISHED') throw new APIError('Content is not available', 404)
      if (content.paywallMode !== 'SUBSCRIPTION_PREVIEW') return Response.json({ data: { contentId: content.id, access: 'FULL', body: await readContentBody(String(content.bodyR2Key ?? '')) } })
      const entitlementCode = String(content.paywallEntitlementCode)
      let entitled = false
      if (req.user) {
        const entitlement = await req.payload.find({ collection: 'entitlements', where: { code: { equals: entitlementCode } }, limit: 1, depth: 0, overrideAccess: true, req })
        const entitlementId = entitlement.docs[0]?.id
        if (entitlementId) {
          const grants = await req.payload.find({ collection: 'entitlement-grants', where: { and: [{ user: { equals: String(req.user.id) } }, { entitlement: { equals: String(entitlementId) } }, { status: { equals: 'ACTIVE' } }] }, limit: 10, depth: 0, overrideAccess: true, req })
          entitled = grants.docs.some((grant) => {
            const now = Date.now()
            const startsAt = grant.startsAt ? new Date(String(grant.startsAt)).getTime() : Number.NEGATIVE_INFINITY
            const endsAt = grant.endsAt ? new Date(String(grant.endsAt)).getTime() : Number.POSITIVE_INFINITY
            return startsAt <= now && now < endsAt
          })
        }
      }
      if (entitled) return Response.json({ data: { contentId: content.id, access: 'FULL', body: await readContentBody(String(content.premiumBodyR2Key ?? '')), entitlement: entitlementCode } })
      return Response.json({ data: { contentId: content.id, access: 'PREVIEW', previewPercent: content.paywallPreviewPercent, body: await readContentBody(String(content.previewBodyR2Key ?? '')), requiredEntitlement: entitlementCode } })
    }, custom: { openapi: { summary: 'Read free content or subscription-gated article preview' } } },
    { path: '/:id/submit-review', method: 'post', handler: async (req) => transitionContentState(req, 'PENDING_REVIEW'), custom: { openapi: { summary: 'Submit content for review' } } },
    { path: '/:id/approve', method: 'post', handler: async (req) => transitionContentState(req, 'APPROVED'), custom: { openapi: { summary: 'Approve content' } } },
    { path: '/:id/reject', method: 'post', handler: async (req) => transitionContentState(req, 'REJECTED'), custom: { openapi: { summary: 'Reject content' } } },
    { path: '/:id/publish', method: 'post', handler: async (req) => {
      const body = (await req.json()) as { expectedVersion?: number; expectedRevision?: number }
      const result = await transitionContentState(req, 'PUBLISHED', body)
      const content = await req.payload.findByID({ collection: 'content', id: String(req.routeParams?.id ?? ''), depth: 0, overrideAccess: true, req })
      if (content.paywallMode === 'SUBSCRIPTION_PREVIEW') await generateContentPaywall(req, content as Record<string, unknown>)
      return result
    }, custom: { openapi: { summary: 'Publish content and generate subscription preview/premium bodies' } } },
    { path: '/:id/restore', method: 'post', handler: async (req) => transitionContentState(req, 'RESTORED'), custom: { openapi: { summary: 'Restore deleted content within the restore window' } } },
  ],
  fields: [
    { name: 'title', type: 'text', required: true, maxLength: 200 }, { name: 'slug', type: 'text', required: true, unique: true, index: true }, { name: 'contentType', type: 'select', required: true, options: contentTypes.map((value) => ({ label: value, value })), index: true },
    { name: 'state', type: 'select', required: true, defaultValue: 'DRAFT', options: contentStates.map((value) => ({ label: value, value })), index: true }, { name: 'author', type: 'relationship', relationTo: 'users', required: true, index: true }, { name: 'ip', type: 'relationship', relationTo: 'ips', index: true },
    { name: 'locale', type: 'text', required: true, defaultValue: 'en-US', index: true }, { name: 'excerpt', type: 'textarea', maxLength: 1000 }, { name: 'bodyR2Key', type: 'text' }, { name: 'coverMedia', type: 'relationship', relationTo: 'media' },
    { name: 'paywallMode', type: 'select', required: true, defaultValue: 'FREE', options: paywallModes.map((value) => ({ label: value, value })), index: true },
    { name: 'paywallPreviewPercent', type: 'number', min: 1, max: 99 },
    { name: 'paywallEntitlementCode', type: 'text', index: true },
    { name: 'previewBodyR2Key', type: 'text' },
    { name: 'premiumBodyR2Key', type: 'text' },
    { name: 'scheduledAt', type: 'date', index: true }, { name: 'publishedAt', type: 'date', index: true }, { name: 'archivedAt', type: 'date' }, { name: 'deletedAt', type: 'date' }, { name: 'version', type: 'number', required: true, defaultValue: 1, min: 1 }, { name: 'revision', type: 'number', required: true, defaultValue: 1, min: 1 },
  ],
  timestamps: true,
}
