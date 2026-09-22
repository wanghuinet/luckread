export const SUBJECT_TYPES = [
  'ANONYMOUS',
  'USER',
  'SERVICE',
  'API_CLIENT',
  'AUTOMATION',
] as const

export type SubjectType = (typeof SUBJECT_TYPES)[number]

export const CHECK_STATUSES = ['PASS', 'FAIL', 'NOT_REQUIRED', 'NOT_APPLICABLE'] as const

export type CheckStatus = (typeof CHECK_STATUSES)[number]

export type AuthorizationChecks = {
  authentication: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_REQUIRED'>
  accountState: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  permission: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  scope: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  resource: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  entitlement?: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  workflow?: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  businessState?: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  credential?: Extract<CheckStatus, 'PASS' | 'FAIL' | 'NOT_APPLICABLE'>
  policy: Extract<CheckStatus, 'PASS' | 'FAIL'>
}

export type AuthorizationSubject = {
  type: SubjectType
  id: string | null
}

export type AuthorizationResource = {
  type: string
  id?: string | null
  scopeType?: 'public' | 'user' | 'organization' | 'ip' | 'platform' | 'none'
  scopeId?: string | null
}

export type AuthorizationEvaluationInput = {
  subject: AuthorizationSubject
  action: string
  resource: AuthorizationResource
  checks: AuthorizationChecks
  policyVersion: string
  authorizationVersion?: string
}

export type AuthorizationDecision = {
  decision: 'ALLOW' | 'DENY'
  subject: AuthorizationSubject
  action: string
  resource: AuthorizationResource
  checks: AuthorizationChecks
  reasonCode?: string
  policyVersion: string
  authorizationVersion?: string
}

const REQUIRED_CHECKS = [
  'authentication',
  'accountState',
  'permission',
  'scope',
  'resource',
  'policy',
] as const

const FAILURE_ORDER: Array<keyof AuthorizationChecks> = [
  'authentication',
  'credential',
  'accountState',
  'permission',
  'scope',
  'resource',
  'entitlement',
  'workflow',
  'businessState',
  'policy',
]

const FAILURE_REASONS: Partial<Record<keyof AuthorizationChecks, string>> = {
  authentication: 'AUTHENTICATION_REQUIRED',
  credential: 'CREDENTIAL_DENIED',
  accountState: 'ACCOUNT_SECURITY_DENY',
  permission: 'PERMISSION_DENIED',
  scope: 'SCOPE_DENIED',
  resource: 'RESOURCE_DENIED',
  entitlement: 'ENTITLEMENT_DENIED',
  workflow: 'WORKFLOW_DENIED',
  businessState: 'BUSINESS_STATE_DENIED',
  policy: 'POLICY_DENIED',
}

function isSubjectType(value: unknown): value is SubjectType {
  return typeof value === 'string' && (SUBJECT_TYPES as readonly string[]).includes(value)
}

function isCheckStatus(value: unknown): value is CheckStatus {
  return typeof value === 'string' && (CHECK_STATUSES as readonly string[]).includes(value)
}

function validateInput(input: AuthorizationEvaluationInput): void {
  if (!input || typeof input !== 'object') throw new Error('missing input')
  if (!input.subject || !isSubjectType(input.subject.type)) throw new Error('invalid subject')
  if (typeof input.subject.id !== 'string' && input.subject.id !== null) throw new Error('invalid subject id')
  if (typeof input.action !== 'string' || input.action.trim().length === 0) throw new Error('invalid action')
  if (!input.resource || typeof input.resource.type !== 'string' || input.resource.type.trim().length === 0) {
    throw new Error('invalid resource')
  }
  if (input.resource.scopeType !== undefined &&
      !['public', 'user', 'organization', 'ip', 'platform', 'none'].includes(input.resource.scopeType)) {
    throw new Error('invalid scope type')
  }
  if (!input.checks || typeof input.checks !== 'object') throw new Error('missing checks')
  if (typeof input.policyVersion !== 'string' || input.policyVersion.trim().length === 0) {
    throw new Error('missing policy version')
  }

  for (const key of REQUIRED_CHECKS) {
    if (!isCheckStatus(input.checks[key])) throw new MissingAuthorizationInputError(key)
  }

  for (const key of Object.keys(input.checks) as Array<keyof AuthorizationChecks>) {
    if (!isCheckStatus(input.checks[key])) throw new Error('invalid check status')
  }
}

class MissingAuthorizationInputError extends Error {
  constructor(readonly check: keyof AuthorizationChecks) {
    super(`missing authorization check: ${check}`)
  }
}

function baseDecision(input: AuthorizationEvaluationInput): AuthorizationDecision {
  return {
    decision: 'ALLOW',
    subject: input.subject,
    action: input.action,
    resource: input.resource,
    checks: { ...input.checks },
    policyVersion: input.policyVersion,
    ...(input.authorizationVersion ? { authorizationVersion: input.authorizationVersion } : {}),
  }
}

export function evaluateAuthorization(input: AuthorizationEvaluationInput): AuthorizationDecision {
  try {
    validateInput(input)
    const decision = baseDecision(input)

    for (const key of FAILURE_ORDER) {
      const status = input.checks[key]
      if (status === 'FAIL') {
        return {
          ...decision,
          decision: 'DENY',
          reasonCode: FAILURE_REASONS[key] ?? 'AUTHORIZATION_DENIED',
        }
      }
    }

    return decision
  } catch (error) {
    if (error instanceof MissingAuthorizationInputError) {
      return {
        ...baseDecision({
          ...input,
          checks: input?.checks ?? ({
            authentication: 'FAIL',
            accountState: 'FAIL',
            permission: 'FAIL',
            scope: 'FAIL',
            resource: 'FAIL',
            policy: 'FAIL',
          } as AuthorizationChecks),
          policyVersion: input?.policyVersion || 'unknown',
        } as AuthorizationEvaluationInput),
        decision: 'DENY',
        reasonCode: 'MISSING_AUTHORIZATION_INPUT',
      }
    }

    const fallback: AuthorizationDecision = {
      decision: 'DENY',
      subject: input?.subject ?? { type: 'ANONYMOUS', id: null },
      action: input?.action ?? 'unknown',
      resource: input?.resource ?? { type: 'unknown', id: null },
      checks: input?.checks ?? ({
        authentication: 'FAIL',
        accountState: 'FAIL',
        permission: 'FAIL',
        scope: 'FAIL',
        resource: 'FAIL',
        policy: 'FAIL',
      } as AuthorizationChecks),
      policyVersion: input?.policyVersion || 'unknown',
      ...(input?.authorizationVersion ? { authorizationVersion: input.authorizationVersion } : {}),
      reasonCode: 'AUTHORIZATION_EVALUATION_FAILED',
    }
    return fallback
  }
}
