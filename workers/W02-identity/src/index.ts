import { createLuckReadAuth, type RateLimitBinding } from './auth/better-auth.js'
import { getW02PostgresRuntime, isW02NeonRuntime } from './neon/runtime.js'
import { publishPendingAccountStateEventsPostgres } from './neon/account-state-publication-journal-publisher-postgres.js'
import { publishPendingSessionRevocationEventsPostgres } from './neon/session-revocation-publisher-postgres.js'
import { publishPendingMfaAuditEventsPostgres } from './neon/mfa-audit-publication-journal-publisher-postgres.js'
import { reconcileMfaAuditOperationReceiptsPostgres } from './neon/mfa-audit-operation-receipt-reconciler-postgres.js'
import { publishPendingAccountStateEvents } from './account/publication-journal-publisher.js'
import { publishPendingMfaAuditEvents } from './auth/mfa-audit-publication-journal.js'
import { publishPendingSessionRevocationEvents } from './auth/session-revocation-publication-journal.js'
import { createD1MfaAuditOperationReceiptStore } from './auth/mfa-audit-operation-receipt-store.js'
import { runScheduledPublicationTicks } from './auth/scheduled-publication.js'
import { createD1RoleLayerStore, resolveLayerForSubject } from './authz/role-layer-store.js'
import { createD1CreatorRoleGrantStore, grantCreatorBusinessRoleWithStore, RoleAssignmentCommandError } from './authz/role-assignment-command.js'
import { mayApproveRoleGrant } from './authz/role-grant-approval-policy.js'
import { AccountStateTransitionError, type AccountState } from './account/account-state-transition.js'
import { createD1AccountStateTransitionStore } from './account/account-state-transition-store.js'
import { createD1RegistrationRollbackStore, RegistrationRollbackStoreError } from './auth/registration-rollback-store.js'
import { resolveBetterAuthPrincipal } from './auth/principal.js'
import { handleCurrentUserSessionList } from './auth/session-list.js'
import { handleCurrentUserSessionRevoke } from './auth/session-revoke.js'
import { handleCurrentUserSessionLogout } from './auth/session-logout.js'
import { handleUsernameChangeRequest, handleUsernameStateRequest } from './auth/username-change.js'
import { handleMfaStatusRequest } from './auth/mfa-status.js'
import { handleMfaEnrollmentStartRequest } from './auth/mfa-enrollment-start.js'
import { handleMfaEnrollmentConfirmRequest } from './auth/mfa-enrollment-confirm.js'
import { verifyTargetBoundSingleApproval, L8BootstrapApprovalError } from './authz/l8-genesis-bootstrap-approval.js'
import { bootstrapSuperAdmin, L8BootstrapCommandError } from './authz/l8-genesis-bootstrap-command.js'
import { checkL8BootstrapReadiness, L8BootstrapReadinessError } from './authz/l8-genesis-bootstrap-readiness.js'
import { bootstrapSuperAdminPostgres, checkL8BootstrapReadinessPostgres } from './neon/l8-genesis-bootstrap-postgres.js'

interface Env {
  D1_01: D1Database
  AUTH_SESSION_READ_LIMITER: RateLimitBinding
  AUTH_SESSION_WRITE_LIMITER: RateLimitBinding
  W02_DATABASE_DRIVER?: string
  HYPERDRIVE?: { connectionString: string }
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  AUTH013_QUEUE: Queue
  AUTH013_PROJECTION_QUEUE: Queue
}

const readJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    const body = await request.json<T>()
    return body && typeof body === 'object' ? body : null
  } catch {
    return null
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  },
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let postgres: ReturnType<typeof getW02PostgresRuntime> | undefined
    try {
      if (isW02NeonRuntime(env)) postgres = getW02PostgresRuntime(env)
    } catch {
      return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'identity service unavailable' } }, 503)
    }
    const url = new URL(request.url)

    if (url.pathname === '/api/auth' || url.pathname.startsWith('/api/auth/')) {
      return createLuckReadAuth(env).handler(request)
    }

    if (request.method === 'POST' && url.pathname === '/internal/account/transition') {
      const body = await readJsonBody<{
        subjectId?: unknown
        targetUserId?: unknown
        to?: unknown
        reason?: unknown
        expectedVersion?: unknown
      }>(request)

      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        typeof body.targetUserId !== 'string' ||
        typeof body.to !== 'string' ||
        typeof body.reason !== 'string' ||
        typeof body.expectedVersion !== 'number' ||
        !Number.isSafeInteger(body.expectedVersion) ||
        body.expectedVersion < 1
      ) {
        return json(
          { error: { code: 'VALIDATION_FAILED', message: 'invalid account-state transition request' } },
          400,
        )
      }

      try {
        const transitionStore = postgres?.accountStateTransitionStore ??
          createD1AccountStateTransitionStore(env.D1_01)
        const result = await transitionStore.transition({
          subjectId: body.subjectId,
          targetUserId: body.targetUserId,
          to: body.to as AccountState,
          reason: body.reason,
          expectedVersion: body.expectedVersion as number,
        })

        return json({
          from: result.from,
          to: result.to,
          auditEventId: result.eventId,
        })
      } catch (error) {
        const code = error instanceof AccountStateTransitionError
          ? error.code
          : 'JOURNAL_PERSISTENCE_FAILED'
        const status =
          code === 'FORBIDDEN' ? 403 :
          code === 'NOT_FOUND' ? 404 :
          code === 'CONFLICT' ? 412 :
          code === 'INVALID_STATE' ? 409 :
          code === 'PRECONDITION_FAILED' ? 412 :
          code === 'INVALID_INPUT' ? 400 :
          503

        return json({
          error: {
            code:
              status === 403 ? 'PERMISSION_DENIED' :
              status === 404 ? 'NOT_FOUND' :
              status === 409 ? 'INVALID_STATE' :
              status === 412 ? 'PRECONDITION_FAILED' :
              status === 400 ? 'VALIDATION_FAILED' :
              'SERVICE_UNAVAILABLE',
            message:
              status === 403 ? 'permission denied' :
              status === 404 ? 'user account not found' :
              status === 409 ? 'invalid account-state transition' :
              status === 412 ? 'account-state precondition failed' :
              status === 400 ? 'invalid account-state request' :
              'account-state service unavailable',
          },
        }, status)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/principal') {
      try {
        const principal = await resolveBetterAuthPrincipal(env, request)
        if (!principal) return json({ active: false }, 401)

        return json({
          active: true,
          userId: principal.userId,
          email: principal.email,
          sessionId: principal.sessionId,
          accountState: principal.accountState,
          accountStateVersion: principal.accountStateVersion,
          layer: principal.layer,
          roleAssignments: principal.roleAssignments,
        })
      } catch {
        return json({ active: false }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/registration/rollback') {
      const body = await readJsonBody<{ userId?: unknown; email?: unknown; username?: unknown }>(request)
      if (!body || typeof body.userId !== 'string' || body.userId.length === 0 || body.userId.length > 128 ||
          typeof body.email !== 'string' || body.email.length === 0 || typeof body.username !== 'string' || body.username.length === 0) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid registration rollback request' } }, 400)
      }

      try {
        const rollbackStore = postgres?.registrationRollbackStore ??
          createD1RegistrationRollbackStore(env.D1_01)
        const result = await rollbackStore.rollback({
          userId: body.userId,
          email: body.email,
          username: body.username,
        })
        return json(result)
      } catch (error) {
        if (error instanceof RegistrationRollbackStoreError) {
          const status = error.code === 'INVALID_INPUT' ? 400 : 412
          return json({
            error: {
              code: error.code === 'INVALID_INPUT' ? 'VALIDATION_FAILED' : 'PRECONDITION_FAILED',
              message: error.code === 'INVALID_INPUT'
                ? 'invalid registration rollback request'
                : error.message,
            },
          }, status)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'registration rollback unavailable' } }, 503)
      }
    }
    if (request.method === 'POST' && url.pathname === '/internal/auth/mfa/enrollment/start') {
      return handleMfaEnrollmentStartRequest(env, request, postgres ? {
        store: postgres.mfaEnrollmentStartStore,
        auth: createLuckReadAuth(env),
      } : {})
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/mfa/enrollment/confirm') {
      return handleMfaEnrollmentConfirmRequest(env, request, postgres ? {
        store: postgres.mfaEnrollmentConfirmStore,
        receiptStore: postgres.mfaAuditOperationReceiptStore,
        statusStore: postgres.mfaStatusStore,
        auth: createLuckReadAuth(env),
      } : {})
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/mfa/status') {
      return handleMfaStatusRequest(env, request, postgres ? { store: postgres.mfaStatusStore } : {})
    }

    if (url.pathname === '/internal/auth/username/state' && request.method === 'GET') {
      return handleUsernameStateRequest(env, request, new Date(), postgres?.usernameChangeStore)
    }

    if (url.pathname === '/internal/auth/username/change' && request.method === 'POST') {
      return handleUsernameChangeRequest(env, request, new Date(), postgres?.usernameChangeStore)
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/list') {
      return handleCurrentUserSessionList(env, request, postgres ? { store: postgres.sessionListStore } : {})
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/revoke-by-id') {
      return handleCurrentUserSessionRevoke(env, request, postgres ? { store: postgres.sessionRevocationStore } : {})
    }

    if (request.method === 'POST' && url.pathname === '/internal/auth/session/logout') {
      return handleCurrentUserSessionLogout(env, request, postgres ? {
        store: postgres.sessionLogoutStore,
        auth: createLuckReadAuth(env),
      } : {})
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/resolve-layer') {
      const body = await readJsonBody<{ subjectId?: unknown }>(request)
      if (!body || typeof body.subjectId !== 'string' || body.subjectId.length < 1 || body.subjectId.length > 128) {
        return json({ decision: 'DENY' }, 400)
      }

      try {
        // The store reads W02-owned account state and evaluates the current
        // role assignments. Neither accountState nor evaluation time is
        // accepted from the internal caller.
        const result = await resolveLayerForSubject(
          postgres?.roleLayerStore ?? createD1RoleLayerStore(env.D1_01),
          body.subjectId,
          new Date().toISOString(),
        )
        return json(result)
      } catch {
        return json({ decision: 'DENY' }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/bootstrap-super-admin/readiness') {
      // This is a read-only preflight. It independently verifies the same
      // protected GitHub workflow identity and target-bound single protected environment approval as
      // the write route but never calls the grant command.
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
      ) {
        return json({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
      }

      const authorization = request.headers.get('authorization') ?? ''
      const tokenMatch = authorization.match(/^Bearer\s+(\S+)$/i)
      if (!tokenMatch || tokenMatch[1].length > 8192) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'GitHub workflow identity token required' } }, 401)
      }

      const body = await readJsonBody<{ requestPrNumber?: unknown; githubToken?: unknown }>(request)
      if (
        !body ||
        !Number.isSafeInteger(body.requestPrNumber) ||
        Number(body.requestPrNumber) < 1 ||
        Number(body.requestPrNumber) > 2_147_483_647 ||
        typeof body.githubToken !== 'string' ||
        body.githubToken.length < 20 ||
        body.githubToken.length > 4096
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid bootstrap readiness envelope' } }, 400)
      }

      try {
        const approval = await verifyTargetBoundSingleApproval({
          oidcToken: tokenMatch[1],
          githubToken: body.githubToken,
          requestPrNumber: body.requestPrNumber as number,
        })
        const readiness = postgres
          ? await checkL8BootstrapReadinessPostgres(postgres.pool, approval)
          : await checkL8BootstrapReadiness(env.D1_01, approval)
        return json({ data: readiness })
      } catch (error) {
        if (error instanceof L8BootstrapApprovalError) {
          const status =
            error.code === 'OIDC_FORBIDDEN' || error.code === 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' ? 403 :
            error.code === 'PR_NOT_MERGED' || error.code === 'REQUEST_FILE_MISSING' || error.code === 'REQUEST_PR_SCOPE_INVALID' ? 409 :
            error.code === 'REQUEST_EXPIRED_OR_INVALID' ? 412 :
            error.code === 'VALIDATION_FAILED' || error.code === 'OIDC_INVALID' ? 400 : 503
          return json({
            error: {
              code: error.code,
              message: status === 403 ? 'single protected environment approval or trusted workflow identity was denied' :
                status === 409 ? 'bootstrap request PR is not an eligible merged request' :
                status === 412 ? 'bootstrap request has expired or violates the request contract' :
                status === 400 ? 'bootstrap evidence was invalid' :
                'bootstrap evidence verification is temporarily unavailable',
            },
          }, status)
        }
        if (error instanceof L8BootstrapReadinessError) {
          const status =
            error.code === 'REQUEST_EXPIRED_OR_INVALID' ? 412 :
            error.code === 'TARGET_NOT_ELIGIBLE' || error.code === 'VERIFIED_ROLE_REQUIRED' ? 403 :
            error.code === 'L8_ALREADY_EXISTS' || error.code === 'BOOTSTRAP_ALREADY_CONSUMED' ? 409 :
            error.code === 'ROLE_MAPPING_INVALID' || error.code === 'SCHEMA_NOT_READY' ? 503 : 400
          return json({
            error: {
              code: error.code,
              message: status === 400 ? 'invalid readiness request' :
                status === 403 ? 'target account is not eligible for bootstrap' :
                status === 409 ? 'the one-time L8 bootstrap path is no longer available' :
                status === 412 ? 'bootstrap request has expired' :
                'required production schema or authorization state is not ready',
            },
          }, status)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'L8 bootstrap readiness unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/bootstrap-super-admin') {
      // First-L8 bootstrap is workflow-authenticated, not application-session-authenticated.
      // W01 is only the public boundary; W02 independently verifies GitHub OIDC, the merged
      // target-bound request PR, one required environment reviewer, one-time state, and the grant.
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W01' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
      ) {
        return json({ error: { code: 'FORBIDDEN', message: 'authorized W01 service boundary required' } }, 403)
      }

      const authorization = request.headers.get('authorization') ?? ''
      const tokenMatch = authorization.match(/^Bearer\s+(\S+)$/i)
      if (!tokenMatch || tokenMatch[1].length > 8192) {
        return json({ error: { code: 'UNAUTHENTICATED', message: 'GitHub workflow identity token required' } }, 401)
      }

      const body = await readJsonBody<{ requestPrNumber?: unknown; githubToken?: unknown }>(request)
      if (
        !body ||
        !Number.isSafeInteger(body.requestPrNumber) ||
        Number(body.requestPrNumber) < 1 ||
        Number(body.requestPrNumber) > 2_147_483_647 ||
        typeof body.githubToken !== 'string' ||
        body.githubToken.length < 20 ||
        body.githubToken.length > 4096
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid bootstrap request envelope' } }, 400)
      }

      try {
        const approval = await verifyTargetBoundSingleApproval({
          oidcToken: tokenMatch[1],
          githubToken: body.githubToken,
          requestPrNumber: body.requestPrNumber as number,
        })
        const grant = postgres
          ? await bootstrapSuperAdminPostgres(postgres.pool, approval)
          : await bootstrapSuperAdmin(env.D1_01, approval)
        return json({
          data: {
            ...grant,
            approvalRef: 'github-pr:' + approval.requestPrNumber + '@' + approval.requestMergeSha,
            approvedReviewers: approval.approvedReviewers,
          },
        })
      } catch (error) {
        if (error instanceof L8BootstrapApprovalError) {
          const status =
            error.code === 'OIDC_FORBIDDEN' || error.code === 'SINGLE_APPROVAL_ENVIRONMENT_NOT_CONFIGURED' ? 403 :
            error.code === 'PR_NOT_MERGED' || error.code === 'REQUEST_FILE_MISSING' || error.code === 'REQUEST_PR_SCOPE_INVALID' ? 409 :
            error.code === 'REQUEST_EXPIRED_OR_INVALID' ? 412 :
            error.code === 'VALIDATION_FAILED' || error.code === 'OIDC_INVALID' ? 400 : 503
          return json({
            error: {
              code: error.code,
              message: status === 403 ? 'single protected environment approval or trusted workflow identity was denied' :
                status === 409 ? 'bootstrap request PR is not an eligible merged request' :
                status === 412 ? 'bootstrap request has expired or violates the request contract' :
                status === 400 ? 'bootstrap evidence was invalid' :
                'bootstrap evidence verification is temporarily unavailable',
            },
          }, status)
        }
        if (error instanceof L8BootstrapCommandError) {
          const status =
            error.code === 'VALIDATION_FAILED' ? 400 :
            error.code === 'TARGET_NOT_ELIGIBLE' || error.code === 'VERIFIED_ROLE_REQUIRED' ? 403 :
            error.code === 'BOOTSTRAP_ALREADY_CONSUMED' || error.code === 'L8_ALREADY_EXISTS' ? 409 :
            error.code === 'REQUEST_EXPIRED_OR_INVALID' ? 412 : 503
          return json({
            error: {
              code: error.code,
              message:
                status === 400 ? 'invalid L8 bootstrap command' :
                status === 403 ? 'target account is not eligible for bootstrap' :
                status === 409 ? 'the one-time L8 bootstrap path is no longer available' :
                status === 412 ? 'bootstrap request has expired' :
                'L8 bootstrap could not be committed',
            },
          }, status)
        }
        return json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'L8 bootstrap service unavailable' } }, 503)
      }
    }

    if (request.method === 'POST' && url.pathname === '/internal/authz/role-assignment') {
      // W08 owns the creator application/scope appointment. W02 independently
      // authenticates the approving administrator and remains the sole writer
      // of RoleAssignment. This path is private to the W08 service binding.
      if (
        request.headers.get('X-LuckRead-Caller') !== 'W08' ||
        request.headers.get('X-LuckRead-Transport-Version') !== '1.0'
      ) {
        return json({ error: { code: 'FORBIDDEN', message: 'authorized internal caller required' } }, 403)
      }

      const actor = await resolveBetterAuthPrincipal(env, request).catch(() => null)
      if (!actor) return json({ error: { code: 'UNAUTHENTICATED', message: 'authenticated approver required' } }, 401)
      if (actor.accountState !== 'ACTIVE') {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'an active approver is required' } }, 403)
      }

      const body = await readJsonBody<{
        subjectId?: unknown
        roleId?: unknown
        scopeType?: unknown
        scopeId?: unknown
        approvalRef?: unknown
      }>(request)
      if (
        !body ||
        typeof body.subjectId !== 'string' ||
        typeof body.roleId !== 'string' ||
        typeof body.scopeType !== 'string' ||
        !(body.scopeId === null || typeof body.scopeId === 'string') ||
        typeof body.approvalRef !== 'string'
      ) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'invalid role assignment command' } }, 400)
      }

      if (body.roleId !== 'creator' || body.scopeType !== 'global' || body.scopeId !== null) {
        return json({ error: { code: 'VALIDATION_FAILED', message: 'only global L3 creator grants are admitted by this endpoint' } }, 400)
      }
      if (!mayApproveRoleGrant(actor.layer)) {
        return json({ error: { code: 'PERMISSION_DENIED', message: 'L7/L8 approval is required' } }, 403)
      }

      try {
        const creatorRoleGrantStore = postgres?.creatorRoleGrantStore ??
          createD1CreatorRoleGrantStore(env.D1_01)
        const result = await grantCreatorBusinessRoleWithStore(creatorRoleGrantStore, {
          subjectId: body.subjectId,
          roleId: body.roleId as 'creator',
          scopeType: body.scopeType as 'global',
          scopeId: body.scopeId,
          approvalRef: body.approvalRef,
        })
        return json({ ...result, approvedBy: actor.userId })
      } catch (error) {
        const code = error instanceof RoleAssignmentCommandError ? error.code : 'ROLE_ASSIGNMENT_WRITE_FAILED'
        const status =
          code === 'VALIDATION_FAILED' ? 400 :
          code === 'ROLE_MAPPING_INVALID' ? 409 :
          code === 'TARGET_NOT_ELIGIBLE' || code === 'VERIFIED_ROLE_REQUIRED' ? 403 :
          code === 'ROLE_ASSIGNMENT_CONFLICT' || code === 'ROLE_ASSIGNMENT_ALREADY_ACTIVE' ? 409 : 503
        return json({
          error: {
            code,
            message:
              status === 400 ? 'invalid role assignment command' :
              status === 403 ? 'target account is not eligible for this role' :
              status === 409 ? 'role assignment conflicts with current authorization state' :
              'role assignment service unavailable',
          },
        }, status)
      }
    }

    return new Response(null, { status: 404 })
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // Safe runtime marker: no user, event, queue payload, or database identifiers.
    console.info('W02 scheduled publication tick', {
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    })
    if (isW02NeonRuntime(env)) {
      const postgres = getW02PostgresRuntime(env)
      await runScheduledPublicationTicks([
        {
          name: 'account-state',
          publish: () => publishPendingAccountStateEventsPostgres(postgres.pool, {
            auth013: env.AUTH013_QUEUE,
            projection: env.AUTH013_PROJECTION_QUEUE,
          }),
        },
        {
          name: 'session-audit',
          publish: () => publishPendingSessionRevocationEventsPostgres(postgres.pool, env.AUTH013_QUEUE),
        },
        {
          name: 'mfa-audit',
          publish: async () => {
            let receiptSummary = { selected: 0, emitted: 0, failed: 0, unknown: 0 }
            try {
              receiptSummary = await reconcileMfaAuditOperationReceiptsPostgres(postgres.pool)
            } catch {
              console.error(JSON.stringify({
                event: 'auth.mfa.audit_receipt_reconcile_failed',
                code: 'MFA_AUDIT_RECEIPT_RECONCILE_FAILED',
              }))
              receiptSummary.failed = 1
            }
            const publication = await publishPendingMfaAuditEventsPostgres(postgres.pool, env.AUTH013_QUEUE)
            return {
              ...publication,
              receiptSelected: receiptSummary.selected,
              receiptEmitted: receiptSummary.emitted,
              receiptFailed: receiptSummary.failed,
              receiptUnknown: receiptSummary.unknown,
            }
          },
        },
      ])
      return
    }

    await runScheduledPublicationTicks([
      { name: 'account-state', publish: () => publishPendingAccountStateEvents(env) },
      { name: 'session-audit', publish: () => publishPendingSessionRevocationEvents(env) },
      {
        name: 'mfa-audit',
        publish: async () => {
          let receiptSummary = { selected: 0, emitted: 0, failed: 0, unknown: 0 }
          try {
            receiptSummary = await createD1MfaAuditOperationReceiptStore(env.D1_01).reconcile()
          } catch {
            // Keep the durable outbox publisher independent from receipt scanning.
            // The fixed code is safe for logs; never print receipt rows or user IDs.
            console.error(JSON.stringify({
              event: 'auth.mfa.audit_receipt_reconcile_failed',
              code: 'MFA_AUDIT_RECEIPT_RECONCILE_FAILED',
            }))
            receiptSummary.failed = 1
          }

          const publication = await publishPendingMfaAuditEvents(env)
          return {
            ...publication,
            receiptSelected: receiptSummary.selected,
            receiptEmitted: receiptSummary.emitted,
            receiptFailed: receiptSummary.failed,
            receiptUnknown: receiptSummary.unknown,
          }
        },
      },
    ])
  },
}
