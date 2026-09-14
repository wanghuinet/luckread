import { APIError } from 'payload'

export const CONTENT_STATES = [
  'DRAFT',
  'PENDING_REVIEW',
  'REJECTED',
  'APPROVED',
  'SCHEDULED',
  'PUBLISHED',
  'UNPUBLISHED',
  'ARCHIVED',
  'DELETED',
  'RESTORED',
] as const

export type ContentState = (typeof CONTENT_STATES)[number]

export type ContentTransition = {
  from: ContentState
  to: ContentState
  actor: 'creator' | 'moderator' | 'system'
  permission: string
  event: string
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
  { from: 'PUBLISHED', to: 'PENDING_REVIEW', actor: 'creator', permission: 'content.update.own', event: 'content.resubmitted' },
  { from: 'UNPUBLISHED', to: 'PUBLISHED', actor: 'creator', permission: 'content.publish.own', event: 'content.published' },
  { from: 'UNPUBLISHED', to: 'DRAFT', actor: 'creator', permission: 'content.update.own', event: 'content.reverted_to_draft' },
  { from: 'ARCHIVED', to: 'DRAFT', actor: 'creator', permission: 'content.unarchive.own', event: 'content.unarchived' },
]

const MODERATOR_ROLES = new Set(['moderator', 'admin', 'super_admin'])

export function resolveContentTransition(from: ContentState, to: ContentState): ContentTransition {
  const transition = CONTENT_TRANSITIONS.find((candidate) => candidate.from === from && candidate.to === to)
  if (!transition) {
    throw new APIError(`Forbidden content transition: ${from} -> ${to}`, 409)
  }
  return transition
}

export function assertContentTransitionActor(args: {
  transition: ContentTransition
  user: { id: string | number; role?: string } | null
  authorId: string | number
}): void {
  const { transition, user, authorId } = args

  if (!user) throw new APIError('Authentication required', 401)
  if (transition.actor === 'system') throw new APIError('System-only transition', 403)

  const isOwner = String(user.id) === String(authorId)
  if (transition.actor === 'creator' && !isOwner) {
    throw new APIError('Content ownership required', 403)
  }

  if (transition.actor === 'moderator' && !MODERATOR_ROLES.has(user.role ?? '')) {
    throw new APIError('Moderator permission required', 403)
  }
}

export function buildContentStatePatch(to: ContentState, now: string): Record<string, unknown> {
  const patch: Record<string, unknown> = { state: to }

  if (to === 'SCHEDULED') patch.scheduledAt = now
  if (to === 'PUBLISHED') patch.publishedAt = now
  if (to === 'ARCHIVED') patch.archivedAt = now
  if (to === 'DELETED') patch.deletedAt = now
  if (to === 'DRAFT' || to === 'UNPUBLISHED' || to === 'REJECTED') {
    if (to !== 'DRAFT') patch.scheduledAt = null
  }

  return patch
}
