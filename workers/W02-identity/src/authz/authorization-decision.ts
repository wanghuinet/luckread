export const SUBJECT_TYPES = ['ANONYMOUS', 'USER', 'SERVICE', 'API_CLIENT', 'AUTOMATION'] as const
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
export type AuthorizationSubject = { type: SubjectType; id: string | null }
export type AuthorizationResource = { type: string; id?: string | null; scopeType?: 'public' | 'user' | 'organization' | 'ip' | 'platform' | 'none'; scopeId?: string | null }
export type AuthorizationEvaluationInput = { subject: AuthorizationSubject; action: string; resource: AuthorizationResource; checks: AuthorizationChecks; policyVersion: string; authorizationVersion?: string }
export type AuthorizationDecision = { decision: 'ALLOW' | 'DENY'; subject: AuthorizationSubject; action: string; resource: AuthorizationResource; checks: AuthorizationChecks; reasonCode?: string; policyVersion: string; authorizationVersion?: string }
const REQUIRED_CHECKS = ['authentication', 'accountState', 'permission', 'scope', 'resource', 'policy'] as const
type FailureKey = keyof AuthorizationChecks
const FAILURE_ORDER: FailureKey[] = ['accountState', 'credential', 'authentication', 'permission', 'scope', 'resource', 'entitlement', 'workflow', 'businessState', 'policy']
const FAILURE_REASONS: Partial<Record<FailureKey, string>> = { accountState: 'ACCOUNT_SECURITY_DENY', credential: 'CREDENTIAL_DENIED', authentication: 'AUTHENTICATION_DENIED', permission: 'PERMISSION_DENIED', scope: 'SCOPE_DENIED', resource: 'RESOURCE_DENIED', entitlement: 'ENTITLEMENT_DENIED', workflow: 'WORKFLOW_DENIED', businessState: 'BUSINESS_STATE_DENIED', policy: 'POLICY_DENIED' }
class MissingAuthorizationInputError extends Error { constructor(readonly check: FailureKey) { super('missing authorization check: ' + check) } }
function isSubjectType(value: unknown): value is SubjectType { return typeof value === 'string' && (SUBJECT_TYPES as readonly string[]).includes(value) }
function isCheckStatus(value: unknown): value is CheckStatus { return typeof value === 'string' && (CHECK_STATUSES as readonly string[]).includes(value) }
function validateShape(input: AuthorizationEvaluationInput): void {
  if (!input || typeof input !== 'object') throw new Error('missing input')
  if (!input.subject || typeof input.subject !== 'object') throw new Error('missing subject')
  if (typeof input.subject.id !== 'string' && input.subject.id !== null) throw new Error('invalid subject id')
  if (typeof input.action !== 'string' || input.action.trim().length === 0) throw new Error('invalid action')
  if (!input.resource || typeof input.resource.type !== 'string' || input.resource.type.trim().length === 0) throw new Error('invalid resource')
  if (input.resource.scopeType !== undefined && !['public', 'user', 'organization', 'ip', 'platform', 'none'].includes(input.resource.scopeType)) throw new Error('invalid scope type')
  if (!input.checks || typeof input.checks !== 'object') throw new Error('missing checks')
  if (typeof input.policyVersion !== 'string' || input.policyVersion.trim().length === 0) throw new Error('missing policy version')
  for (const key of REQUIRED_CHECKS) if (!isCheckStatus(input.checks[key])) throw new MissingAuthorizationInputError(key)
  for (const key of Object.keys(input.checks) as FailureKey[]) if (!isCheckStatus(input.checks[key])) throw new Error('invalid check status')
}
function safeSubject(subject: AuthorizationSubject | undefined): AuthorizationSubject { return subject && isSubjectType(subject.type) ? subject : { type: 'ANONYMOUS', id: null } }
function safeChecks(checks: AuthorizationChecks | undefined): AuthorizationChecks {
  const fallback: AuthorizationChecks = {
    authentication: 'FAIL',
    accountState: 'FAIL',
    permission: 'FAIL',
    scope: 'FAIL',
    resource: 'FAIL',
    policy: 'FAIL',
  }
  if (!checks || typeof checks !== 'object') return fallback

  for (const key of Object.keys(checks) as Array<keyof AuthorizationChecks>) {
    const value = checks[key]
    if (isCheckStatus(value)) {
      ;(fallback as Record<string, CheckStatus | undefined>)[key] = value
    }
  }
  return fallback
}
function baseDecision(input: AuthorizationEvaluationInput): AuthorizationDecision { return { decision: 'ALLOW', subject: safeSubject(input.subject), action: input.action, resource: input.resource, checks: safeChecks(input.checks), policyVersion: input.policyVersion, ...(input.authorizationVersion ? { authorizationVersion: input.authorizationVersion } : {}) } }
function deny(input: AuthorizationEvaluationInput, reasonCode: string): AuthorizationDecision { return { ...baseDecision(input), decision: 'DENY', reasonCode } }
export function evaluateAuthorization(input: AuthorizationEvaluationInput): AuthorizationDecision {
  try {
    validateShape(input)
    const decision = baseDecision(input)
    if (input.checks.accountState === 'FAIL') return deny(input, FAILURE_REASONS.accountState!)
    if (input.checks.credential === 'FAIL') return deny(input, FAILURE_REASONS.credential!)
    if (input.checks.authentication === 'FAIL') return deny(input, FAILURE_REASONS.authentication!)
    if (!isSubjectType(input.subject.type)) return deny(input, 'SUBJECT_TYPE_CHECK')
    for (const key of FAILURE_ORDER.slice(3)) if (input.checks[key] === 'FAIL') return deny(input, FAILURE_REASONS[key] ?? 'AUTHORIZATION_DENIED')
    return decision
  } catch (error) {
    if (error instanceof MissingAuthorizationInputError) {
      const fallback = { ...(input as Partial<AuthorizationEvaluationInput>), subject: safeSubject(input?.subject), checks: safeChecks(input?.checks), policyVersion: input?.policyVersion || 'unknown' } as AuthorizationEvaluationInput
      return deny(fallback, 'MISSING_AUTHORIZATION_INPUT')
    }
    const fallback = { subject: safeSubject(input?.subject), action: input?.action || 'unknown', resource: input?.resource ?? { type: 'unknown', id: null }, checks: safeChecks(input?.checks), policyVersion: input?.policyVersion || 'unknown', ...(input?.authorizationVersion ? { authorizationVersion: input.authorizationVersion } : {}) } as AuthorizationEvaluationInput
    return deny(fallback, 'AUTHORIZATION_EVALUATION_FAILED')
  }
}
