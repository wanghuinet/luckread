import { APIError } from 'payload'

import { assertOwnedPermission, assertPermission, type AuthorizationUser } from './authorization'

export const CONTENT_STATES = ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'APPROVED', 'SCHEDULED', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED', 'DELETED', 'RESTORED'] as const
export type ContentState = (typeof CONTENT_STATES)[number]

export type ContentTransition = {
  from: ContentState
  to: ContentState
  actor: 'creator' | 'moderator' | 'system'
  permission: string
  event: string
  precondition?: 'material_edit_requires_review' | 'within_restore_window'
}

export const CONTENT_TRANSITIONS: readonly ContentTransition[] = [
  { from: 'DRAFT', to: 'PENDING_REVIEW', actor: 'creator', permission: 'content.submit_review.own', event: 'content.submitted' },
  { from: 'PENDING_REVIEW', to: 'APPROVED', actor: 'moderator', permission: 'moderation.decide', event: 'content.approved' },
  { from: 'PENDING_REVIEW', to: 'REJECTED', actor: 'moderator', permission: 'moderation.decide', event: 'content.rejected' },
  { from: 'REJECTED', to: 'DRAFT', actor: 'creator', permission: 'content.update.own', event: 'content.reopened' },
  { from: 'APPROVED', to: 'SCHEDULED', actor: 'creator', permission: 'content.schedule.own', event: 'content.scheduled' },
  { from: 'APPROVED', to: 'PUBLISHED', actor: 'creator', permission: 'content.publish.own', event: 'content.published' },
  { from: 'SCHEDULED', to: 'PUBLISHED', actor: 'system', permission: 'system.job', event: 'content.published' },
  { from: 'SCHEDULED', to: 'DRAFT', actor: 'creator', permission: 'content.update.own', event: 'content.unscheduled' },
  { from: 'PUBLISHED', to: 'UNPUBLISHED', actor: 'creator', permission: 'content.unpublish.own', event: 'content.unpublished' },
  { from: 'PUBLISHED', to: 'ARCHIVED', actor: 'creator', permission: 'content.archive.own', event: 'content.archived' },
  { from: 'PUBLISHED', to: 'PENDING_REVIEW', actor: 'creator', permission: 'content.update.own', precondition: 'material_edit_requires_review', event: 'content.resubmitted' },
  { from: 'UNPUBLISHED', to: 'PUBLISHED', actor: 'creator', permission: 'content.publish.own', event: 'content.published' },
  { from: 'UNPUBLISHED', to: 'DRAFT', actor: 'creator', permission: 'content.update.own', event: 'content.reverted_to_draft' },
  { from: 'ARCHIVED', to: 'DRAFT', actor: 'creator', permission: 'content.update.own', event: 'content.unarchived' },
  { from: 'DRAFT', to: 'DELETED', actor: 'creator', permission: 'content.delete.own', event: 'content.deleted' },
  { from: 'PUBLISHED', to: 'DELETED', actor: 'creator', permission: 'content.delete.own', event: 'content.deleted' },
  { from: 'UNPUBLISHED', to: 'DELETED', actor: 'creator', permission: 'content.delete.own', event: 'content.deleted' },
  { from: 'ARCHIVED', to: 'DELETED', actor: 'creator', permission: 'content.delete.own', event: 'content.deleted' },
  { from: 'DELETED', to: 'RESTORED', actor: 'creator', permission: 'content.restore.own', precondition: 'within_restore_window', event: 'content.restored' },
  { from: 'RESTORED', to: 'DRAFT', actor: 'system', permission: 'system.job', event: 'content.reverted_to_draft' },
]

export const CONTENT_RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const MATERIAL_CONTENT_FIELDS = ['title', 'slug', 'contentType', 'locale', 'excerpt', 'bodyR2Key', 'coverMedia'] as const

export function resolveContentTransition(from: ContentState, to: ContentState): ContentTransition {
  const transition = CONTENT_TRANSITIONS.find((candidate) => candidate.from === from && candidate.to === to)
  if (!transition) throw new APIError(`Forbidden content transition: ${from} -> ${to}`, 409)
  return transition
}

export function assertContentTransitionActor(args: { transition: ContentTransition; user: AuthorizationUser | null; authorId: string | number }): void {
  const { transition, user, authorId } = args
  if (transition.actor === 'system') throw new APIError('System-only transition', 403)
  if (transition.actor === 'creator') {
    assertOwnedPermission({ user, permission: transition.permission, ownerId: authorId })
    return
  }
  assertPermission(user, transition.permission)
}

export function hasMaterialContentEdit(data: Record<string, unknown>, originalDoc: Record<string, unknown>): boolean {
  return MATERIAL_CONTENT_FIELDS.some((field) => data[field] !== undefined && String(data[field] ?? '') !== String(originalDoc[field] ?? ''))
}

export function assertWithinRestoreWindow(deletedAt: unknown, now = new Date()): void {
  if (typeof deletedAt !== 'string' && !(deletedAt instanceof Date)) throw new APIError('Content restore window is unavailable', 409)
  const deletedTimestamp = deletedAt instanceof Date ? deletedAt.getTime() : Date.parse(deletedAt)
  if (Number.isNaN(deletedTimestamp) || deletedTimestamp + CONTENT_RESTORE_WINDOW_MS < now.getTime()) {
    throw new APIError('Content restore window has expired', 409)
  }
}

export function buildContentStatePatch(to: ContentState, now: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { state: to }
  if (to === 'SCHEDULED') patch.scheduledAt = now
  if (to === 'PUBLISHED') patch.publishedAt = now
  if (to === 'ARCHIVED') patch.archivedAt = now
  if (to === 'DELETED') patch.deletedAt = now
  if (to === 'DRAFT' || to === 'UNPUBLISHED' || to === 'REJECTED') patch.scheduledAt = null
  if (to === 'RESTORED') patch.deletedAt = null
  return patch
}
