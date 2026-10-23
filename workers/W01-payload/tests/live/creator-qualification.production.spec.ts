import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { test, type BrowserContext, type Page } from '@playwright/test'

type LoginPayload = {
  data?: {
    user?: {
      emailVerified?: unknown
    }
  }
}

type CreatorApplicationSummary = {
  status?: unknown
  grant_state?: unknown
}

type CreatorApiPayload = {
  data?: {
    application?: CreatorApplicationSummary | null
    applicationId?: unknown
    status?: unknown
    grantState?: unknown
  }
}

type AcceptanceCheck = {
  name: string
  pass: boolean
  [key: string]: string | number | boolean | null
}

type AcceptanceEvidence = {
  evidenceType: string
  startedAt: string
  finishedAt: string | null
  sourceSha: string
  workflowRunId: string
  workflowRunAttempt: string
  baseURL: string
  credentialsLogged: false
  responseBodiesStored: false
  sessionTokensStored: false
  cookieValuesStored: false
  status: 'PENDING' | 'PASS' | 'FAIL'
  failureStage?: string
  failureType?: string
  summary?: { total: number; passed: number; failed: number }
  checks: AcceptanceCheck[]
}

const baseURL = 'https://mp.luckread.com'
const apiBaseURL = 'https://api.luckread.com'
const applicantEmail = process.env.LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL?.trim() ?? ''
const applicantPassword = process.env.LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD ?? ''
const reviewerEmail = process.env.LUCKREAD_CREATOR_E2E_REVIEWER_EMAIL?.trim() ?? ''
const reviewerPassword = process.env.LUCKREAD_CREATOR_E2E_REVIEWER_PASSWORD ?? ''
const runId = (process.env.GITHUB_RUN_ID || 'local').replace(/[^A-Za-z0-9_-]/g, '_')
const runAttempt = (process.env.GITHUB_RUN_ATTEMPT || '1').replace(/[^A-Za-z0-9_-]/g, '_')
const evidenceDir = resolve('artifacts/creator-authorization-live-e2e')
const evidencePath = resolve(evidenceDir, 'creator-authorization-live-e2e-' + runId + '-' + runAttempt + '.json')

const evidence: AcceptanceEvidence = {
  evidenceType: 'LUCKREAD_CREATOR_QUALIFICATION_L2_TO_L3_LIVE_E2E',
  startedAt: new Date().toISOString(),
  finishedAt: null,
  sourceSha: process.env.LUCKREAD_SOURCE_SHA || process.env.GITHUB_SHA || 'unknown',
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  baseURL,
  credentialsLogged: false,
  responseBodiesStored: false,
  sessionTokensStored: false,
  cookieValuesStored: false,
  status: 'PENDING',
  checks: [],
}

let stage = 'credential_preflight'
let testCompleted = false
let testThrew = false
let applicantContext: BrowserContext | undefined
let reviewerContext: BrowserContext | undefined

const record = (
  name: string,
  pass: boolean,
  facts: Record<string, string | number | boolean | null> = {},
): void => {
  evidence.checks.push({ name, pass, ...facts })
  console.log((pass ? 'PASS ' : 'FAIL ') + name)
  if (!pass) throw new Error('Creator qualification production E2E failed at ' + name)
}

async function readJson(response: { json: () => Promise<unknown> }): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function login(page: Page, roleName: string, email: string, password: string, returnTo: string): Promise<string> {
  stage = roleName + '_login'
  await page.goto('/login?returnTo=' + encodeURIComponent(returnTo))
  const loginResponsePromise = page.waitForResponse(
    (response) => {
      try {
        return new URL(response.url()).hostname === 'api.luckread.com' && new URL(response.url()).pathname === '/v1/auth/login' &&
          response.request().method() === 'POST'
      } catch {
        return false
      }
    },
    { timeout: 20_000 },
  )
  await page.getByLabel('邮箱').fill(email)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  const loginResponse = await loginResponsePromise
  const loginPayload = await readJson(loginResponse) as LoginPayload | null
  const emailVerified = loginPayload?.data?.user?.emailVerified === true
  record(roleName + '_login_with_verified_account', loginResponse.status() === 200 && emailVerified, {
    httpStatus: loginResponse.status(),
    emailVerified,
  })

  const sessionToken = loginResponse.headers()['x-luckread-session-token']?.trim() ?? ''
  record(roleName + '_native_session_header_present', sessionToken.length > 0, {
    sessionHeaderPresent: sessionToken.length > 0,
  })

  let routedToExpectedPage = false
  try {
    await page.waitForURL((url) => url.pathname === returnTo, { timeout: 20_000 })
    routedToExpectedPage = true
  } catch {
    routedToExpectedPage = false
  }
  record(roleName + '_redirect_to_authorized_target', routedToExpectedPage, {
    routedToExpectedPage,
  })
  return sessionToken
}

async function nativeGet(path: string, sessionToken: string): Promise<{ response: Response; payload: CreatorApiPayload | null }> {
  const response = await fetch(apiBaseURL + path, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + sessionToken,
      'cache-control': 'no-store',
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  })
  return {
    response,
    payload: await readJson(response) as CreatorApiPayload | null,
  }
}

test('L2 applicant submits, L7/L8 reviewer grants L3, and creator center accepts the promoted session', async ({ browser }) => {
  try {
    stage = 'credential_preflight'
    const missingFields = [
      ['LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL', applicantEmail],
      ['LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD', applicantPassword],
      ['LUCKREAD_CREATOR_E2E_REVIEWER_EMAIL', reviewerEmail],
      ['LUCKREAD_CREATOR_E2E_REVIEWER_PASSWORD', reviewerPassword],
    ].filter(([, value]) => !value).map(([name]) => name)
    record('dedicated_e2e_credential_secrets_configured', missingFields.length === 0, {
      missingFields: missingFields.join(','),
    })

    const distinctAccounts = new Set([applicantEmail.toLowerCase(), reviewerEmail.toLowerCase()])
    record('applicant_and_reviewer_are_distinct_accounts', applicantEmail.length > 0 &&
      reviewerEmail.length > 0 && distinctAccounts.size === 2)

    stage = 'applicant_login'
    applicantContext = await browser.newContext()
    const applicantPage = await applicantContext.newPage()
    const applicantToken = await login(
      applicantPage,
      'applicant',
      applicantEmail,
      applicantPassword,
      '/creator-application',
    )

    let applicationFormVisible = false
    try {
      await applicantPage.getByRole('button', { name: '提交创作者申请', exact: true })
        .waitFor({ state: 'visible', timeout: 20_000 })
      applicationFormVisible = true
    } catch {
      applicationFormVisible = false
    }
    record('applicant_layer_l2_can_access_application_form', applicationFormVisible, {
      applicationFormVisible,
    })

    stage = 'applicant_application_preflight'
    const cookieBefore = await applicantContext.request.get(apiBaseURL + '/v1/creator-applications', {
      headers: { accept: 'application/json', 'cache-control': 'no-store' },
      timeout: 15_000,
    })
    const cookiePayload = await cookieBefore.json().catch((): null => null) as CreatorApiPayload | null
    const cookieHasNoApplication = cookiePayload?.data?.application === null
    record('fresh_l2_applicant_has_no_prior_creator_application', cookieBefore.status() === 200 && cookieHasNoApplication, {
      httpStatus: cookieBefore.status(),
      applicationPresent: !cookieHasNoApplication,
    })

    const bearerBefore = await nativeGet('/v1/creator-applications', applicantToken)
    const bearerHasNoApplication = bearerBefore.payload?.data?.application === null
    record('native_bearer_session_reads_own_application_without_cookie', bearerBefore.response.status === 200 &&
      bearerHasNoApplication, {
        httpStatus: bearerBefore.response.status,
        applicationPresent: !bearerHasNoApplication,
      })

    stage = 'reviewer_login_and_authorization_preflight'
    reviewerContext = await browser.newContext()
    const reviewerPage = await reviewerContext.newPage()
    await login(reviewerPage, 'reviewer', reviewerEmail, reviewerPassword, '/creator-review')
    let reviewerReviewPageVisible = false
    try {
      await reviewerPage.getByRole('heading', { name: '创作者资格审核', exact: true })
        .waitFor({ state: 'visible', timeout: 20_000 })
      reviewerReviewPageVisible = new URL(reviewerPage.url()).pathname === '/creator-review'
    } catch {
      reviewerReviewPageVisible = false
    }
    record('reviewer_layer_l7_or_l8_can_access_review_queue', reviewerReviewPageVisible, {
      reviewPageVisible: reviewerReviewPageVisible,
    })

    stage = 'creator_application_submission'
    const statement = 'Creator qualification production E2E ' + runId + ' ' + randomUUID()
    await applicantPage.locator('select').selectOption('WRITER')
    await applicantPage.getByPlaceholder('简要介绍你的创作方向、计划发布的内容或相关作品。').fill(statement)
    const submitResponsePromise = applicantPage.waitForResponse(
      (response) => {
        try {
          return new URL(response.url()).hostname === 'api.luckread.com' && new URL(response.url()).pathname === '/v1/creator-applications' &&
            response.request().method() === 'POST'
        } catch {
          return false
        }
      },
      { timeout: 20_000 },
    )
    await applicantPage.getByRole('button', { name: '提交创作者申请', exact: true }).click()
    const submitResponse = await submitResponsePromise
    const submitPayload = await readJson(submitResponse) as CreatorApiPayload | null
    const applicationId = submitPayload?.data?.applicationId
    const applicationSubmitted = submitResponse.status() === 201 &&
      submitPayload?.data?.status === 'PENDING' &&
      typeof applicationId === 'string' && applicationId.length > 0
    record('l2_application_is_created_as_pending', applicationSubmitted, {
      httpStatus: submitResponse.status(),
      applicationStatus: typeof submitPayload?.data?.status === 'string' ? submitPayload.data.status : 'unknown',
    })

    let applicantSeesPending = false
    try {
      await applicantPage.getByText('等待审核', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 })
      applicantSeesPending = true
    } catch {
      applicantSeesPending = false
    }
    record('applicant_ui_shows_pending_status', applicantSeesPending, {
      pendingStatusVisible: applicantSeesPending,
    })

    stage = 'reviewer_approval_and_l3_grant'
    await reviewerPage.reload({ waitUntil: 'domcontentloaded' })
    const reviewCard = reviewerPage.locator('article').filter({ hasText: statement }).first()
    let reviewCardVisible = false
    try {
      await reviewCard.waitFor({ state: 'visible', timeout: 20_000 })
      reviewCardVisible = true
    } catch {
      reviewCardVisible = false
    }
    record('authorized_review_queue_contains_submitted_application', reviewCardVisible, {
      reviewCardVisible,
    })

    const approveButton = reviewCard.getByRole('button', { name: '通过并授予 L3', exact: true })
    const decisionResponsePromise = reviewerPage.waitForResponse(
      (response) => {
        try {
          return new URL(response.url()).hostname === 'api.luckread.com' && new URL(response.url()).pathname === '/v1/admin/creator-applications' &&
            response.request().method() === 'POST'
        } catch {
          return false
        }
      },
      { timeout: 20_000 },
    )
    await approveButton.click()
    const decisionResponse = await decisionResponsePromise
    const decisionPayload = await readJson(decisionResponse) as CreatorApiPayload | null
    const grantConfirmed = decisionResponse.status() === 200 &&
      decisionPayload?.data?.status === 'APPROVED' &&
      decisionPayload?.data?.grantState === 'GRANTED'
    record('l7_l8_approval_confirms_w02_l3_role_grant', grantConfirmed, {
      httpStatus: decisionResponse.status(),
      applicationStatus: typeof decisionPayload?.data?.status === 'string' ? decisionPayload.data.status : 'unknown',
      grantState: typeof decisionPayload?.data?.grantState === 'string' ? decisionPayload.data.grantState : 'unknown',
    })

    stage = 'native_bearer_post_grant_verification'
    const bearerAfter = await nativeGet('/v1/creator-applications', applicantToken)
    const promotedApplication = bearerAfter.payload?.data?.application
    const bearerSeesGrant = bearerAfter.response.status === 200 &&
      promotedApplication?.status === 'APPROVED' &&
      promotedApplication?.grant_state === 'GRANTED'
    record('native_bearer_session_reads_approved_granted_application', bearerSeesGrant, {
      httpStatus: bearerAfter.response.status,
      applicationStatus: typeof promotedApplication?.status === 'string' ? promotedApplication.status : 'unknown',
      grantState: typeof promotedApplication?.grant_state === 'string' ? promotedApplication.grant_state : 'unknown',
    })

    stage = 'applicant_ui_and_creator_center_access'
    await applicantPage.reload({ waitUntil: 'domcontentloaded' })
    let applicantSeesGranted = false
    try {
      await applicantPage.getByText('已通过 · 权限已生效', { exact: true })
        .waitFor({ state: 'visible', timeout: 20_000 })
      applicantSeesGranted = true
    } catch {
      applicantSeesGranted = false
    }
    record('applicant_ui_confirms_granted_status', applicantSeesGranted, {
      grantedStatusVisible: applicantSeesGranted,
    })

    await applicantPage.goto('/creator-center', { waitUntil: 'domcontentloaded' })
    let creatorCenterAccessible = false
    try {
      const pathMatches = new URL(applicantPage.url()).pathname === '/creator-center'
      const centerLabel = applicantPage.getByText('创作者中心', { exact: true }).first()
      await centerLabel.waitFor({ state: 'visible', timeout: 20_000 })
      creatorCenterAccessible = pathMatches
    } catch {
      creatorCenterAccessible = false
    }
    record('promoted_l3_applicant_can_open_creator_center', creatorCenterAccessible, {
      creatorCenterAccessible,
    })

    testCompleted = true
  } catch (error) {
    testThrew = true
    evidence.failureStage = stage
    evidence.failureType = error instanceof Error ? error.name : 'UnknownError'
    throw error
  } finally {
    if (applicantContext) await applicantContext.close().catch((): undefined => undefined)
    if (reviewerContext) await reviewerContext.close().catch((): undefined => undefined)
    evidence.finishedAt = new Date().toISOString()
    const failedChecks = evidence.checks.filter((item) => !item.pass).length
    evidence.summary = {
      total: evidence.checks.length,
      passed: evidence.checks.length - failedChecks,
      failed: failedChecks + (testThrew && failedChecks === 0 ? 1 : 0),
    }
    evidence.status = testCompleted && !testThrew && failedChecks === 0 ? 'PASS' : 'FAIL'
    await mkdir(evidenceDir, { recursive: true })
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 })
    console.log('Sanitized creator authorization evidence written: ' + evidencePath)
    console.log('Creator authorization E2E status=' + evidence.status +
      '; credentials and session material were not written.')
  }
})
