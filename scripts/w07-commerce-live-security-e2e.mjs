import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const baseUrl = (process.env.LUCKREAD_API_BASE_URL || 'https://api.luckread.com').replace(/\/$/, '')
const origin = (process.env.LUCKREAD_BROWSER_ORIGIN || 'https://luckread.com').replace(/\/$/, '')
const runId = process.env.GITHUB_RUN_ID || 'local'
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1'
const sourceSha = process.env.GITHUB_SHA || 'unknown'
const outDir = resolve('artifacts/w07-commerce-live-security-e2e')
const outFile = resolve(outDir, `w07-commerce-live-security-e2e-${runId}-${runAttempt}.json`)
const users = [
  { label: 'primary', email: process.env.LUCKREAD_APP_AUTH_SMOKE_EMAIL || '', password: process.env.LUCKREAD_APP_AUTH_SMOKE_PASSWORD || '' },
  { label: 'foreign_fixture_owner', email: process.env.LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL || '', password: process.env.LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD || '' },
]
const routes = [
  ['payment_history', '/v1/payments/history'],
  ['refund_history', '/v1/payments/refunds'],
  ['billing_documents', '/v1/billing/documents'],
]
const result = {
  evidenceType: 'LUCKREAD_W07_COMMERCE_LIVE_SECURITY_E2E',
  timestamp: new Date().toISOString(),
  baseUrl,
  workflowRunId: runId,
  workflowRunAttempt: runAttempt,
  sourceSha,
  credentialsLogged: false,
  responseBodiesStored: false,
  sessionTokensStored: false,
  cookieValuesStored: false,
  financialMutationRequested: false,
  providerMutationRequested: false,
  checks: [],
  status: 'PENDING',
}

function check(name, pass, facts = {}) {
  result.checks.push({ name, pass, ...facts })
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`)
}

function errorCode(json) {
  const value = json?.error?.code
  return typeof value === 'string' && /^[A-Z0-9_-]{1,80}$/.test(value) ? value : null
}

class CookieJar {
  #values = new Map()
  update(headers) {
    for (const header of headers) {
      const pair = header.split(';', 1)[0]
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (!value || /max-age=0|expires=Thu, 01 Jan 1970/i.test(header)) this.#values.delete(name)
      else this.#values.set(name, value)
    }
  }
  header() { return [...this.#values].map(([name, value]) => `${name}=${value}`).join('; ') }
  names() { return [...this.#values.keys()].sort() }
  hasSession() { return this.names().some((name) => /better-auth\.session_token/i.test(name)) }
}

async function request(method, path, options = {}) {
  const headers = {
    accept: 'application/json',
    ...(method === 'GET' ? {} : { origin }),
    ...(options.jar?.header() ? { cookie: options.jar.header() } : {}),
    ...(options.headers || {}),
  }
  try {
    const response = await fetch(baseUrl + path, {
      method, headers,
      ...(options.body === undefined ? {} : { body: options.body }),
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    })
    const setCookies = typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie')].filter(Boolean)
    options.jar?.update(setCookies)
    const raw = await response.text()
    let json = null
    try { json = raw ? JSON.parse(raw) : null } catch {}
    return {
      status: response.status, json, rawLength: raw.length, setCookies,
      errorCode: errorCode(json), cacheControl: response.headers.get('cache-control'),
    }
  } catch (error) {
    return { status: null, json: null, rawLength: 0, setCookies: [],
      errorCode: null, transportError: error instanceof Error ? error.name : typeof error }
  }
}

async function login(user) {
  const jar = new CookieJar()
  const r = await request('POST', '/v1/auth/login', {
    jar,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: user.email, credential: user.password }),
  })
  const account = r.json?.data?.user
  const pass = r.status === 200 && typeof account?.id === 'string' &&
    typeof account.email === 'string' &&
    account.email.trim().toLowerCase() === user.email.trim().toLowerCase() &&
    account.emailVerified === true && jar.hasSession()
  check(`${user.label}_login_verified_cookie_session`, pass, {
    status: r.status, emailVerified: account?.emailVerified === true,
    sessionCookiePresent: jar.hasSession(), cookieNames: jar.names(), errorCode: r.errorCode,
  })
  return pass ? { label: user.label, jar, userId: account.id } : null
}

async function readPage(user, name, path) {
  const items = []
  let cursor = null
  let pages = 0
  let hasMore = true
  let pass = true
  let finalStatus = null
  let cacheNoStore = true
  while (hasMore && pages < 5) {
    const query = new URLSearchParams({ limit: '50' })
    if (cursor) query.set('cursor', cursor)
    const r = await request('GET', path + '?' + query.toString(), { jar: user.jar })
    finalStatus = r.status
    pages += 1
    cacheNoStore &&= typeof r.cacheControl === 'string' && r.cacheControl.toLowerCase().includes('no-store')
    const data = r.json?.data
    const valid = r.status === 200 && data && Array.isArray(data.items) &&
      data.items.length <= 50 && typeof data.hasMore === 'boolean' &&
      (data.nextCursor === null || (typeof data.nextCursor === 'string' && data.nextCursor.length > 0 && data.nextCursor.length <= 512))
    if (!valid) { pass = false; break }
    items.push(...data.items)
    hasMore = data.hasMore
    cursor = data.nextCursor
    if (hasMore && !cursor) pass = false
  }
  const passed = pass && !hasMore && finalStatus === 200 && cacheNoStore && pages <= 5
  check(`${user.label}_${name}`, passed, {
    status: finalStatus, pages, itemCount: items.length, cacheNoStore, paginationComplete: !hasMore,
  })
  return passed ? items : null
}
const values = (items, key) => new Set(items.map((item) => item?.[key]).filter((v) => typeof v === 'string' && v.length > 0))
const leaks = (items, key, foreign) => items.some((item) => typeof item?.[key] === 'string' && foreign.has(item[key]))

async function finish() {
  const failed = result.checks.filter((item) => !item.pass)
  result.summary = { total: result.checks.length, passed: result.checks.length - failed.length, failed: failed.length }
  if (result.status === 'PENDING') result.status = failed.length === 0 ? 'PASS' : 'FAIL'
  await mkdir(outDir, { recursive: true })
  await writeFile(outFile, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
  console.log(`Sanitized evidence written: ${outFile}`)
  console.log(`Summary: ${result.summary.passed}/${result.summary.total}; ${result.status}`)
  if (result.status !== 'PASS') process.exitCode = 1
}

try {
  const missing = [
    !users[0].email ? 'LUCKREAD_APP_AUTH_SMOKE_EMAIL' : null,
    !users[0].password ? 'LUCKREAD_APP_AUTH_SMOKE_PASSWORD' : null,
    !users[1].email ? 'LUCKREAD_CREATOR_E2E_APPLICANT_EMAIL' : null,
    !users[1].password ? 'LUCKREAD_CREATOR_E2E_APPLICANT_PASSWORD' : null,
  ].filter(Boolean)
  if (missing.length) {
    result.status = 'BLOCKED_MISSING_GITHUB_ACTIONS_SECRETS'
    check('two_verified_qa_accounts_configured', false, { missingSecretNames: missing })
    await finish()
  } else if (users[0].email.trim().toLowerCase() === users[1].email.trim().toLowerCase()) {
    result.status = 'BLOCKED_QA_ACCOUNTS_NOT_DISTINCT'
    check('two_distinct_qa_accounts', false)
    await finish()
  } else {
    check('two_distinct_qa_accounts', true)
    const [primary, foreign] = await Promise.all(users.map(login))
    if (!primary || !foreign) {
      result.status = 'BLOCKED_QA_LOGIN_OR_VERIFICATION'
      for (const user of [primary, foreign].filter(Boolean)) {
        await request('POST', '/v1/auth/logout', { jar: user.jar })
      }
      await finish()
    } else if (primary.userId === foreign.userId) {
      result.status = 'BLOCKED_QA_ACCOUNTS_RESOLVE_TO_SAME_USER'
      check('two_distinct_authenticated_user_ids', false)
      for (const user of [primary, foreign]) await request('POST', '/v1/auth/logout', { jar: user.jar })
      await finish()
    } else {
      check('two_distinct_authenticated_user_ids', true)
      const primaryPages = {}
      const foreignPages = {}
      for (const [name, path] of routes) {
        primaryPages[name] = await readPage(primary, name, path)
        foreignPages[name] = await readPage(foreign, name, path)
      }
      if (Object.values(primaryPages).some((v) => v === null) || Object.values(foreignPages).some((v) => v === null)) {
        result.status = 'FAIL_LIVE_BILLING_READS'
      } else {
        const foreignPayments = values(foreignPages.payment_history, 'paymentId')
        const foreignOrders = new Set([
          ...values(foreignPages.payment_history, 'orderId'),
          ...values(foreignPages.refund_history, 'orderId'),
          ...values(foreignPages.billing_documents, 'orderId'),
        ])
        const foreignRefunds = values(foreignPages.refund_history, 'refundId')
        const foreignDocuments = values(foreignPages.billing_documents, 'documentId')
        const primaryPayments = values(primaryPages.payment_history, 'paymentId')
        const primaryOrders = new Set([
          ...values(primaryPages.payment_history, 'orderId'),
          ...values(primaryPages.refund_history, 'orderId'),
          ...values(primaryPages.billing_documents, 'orderId'),
        ])
        const primaryRefunds = values(primaryPages.refund_history, 'refundId')
        const primaryDocuments = values(primaryPages.billing_documents, 'documentId')
        const isolated =
          !leaks(primaryPages.payment_history, 'paymentId', foreignPayments) &&
          !leaks(primaryPages.payment_history, 'orderId', foreignOrders) &&
          !leaks(primaryPages.refund_history, 'paymentId', foreignPayments) &&
          !leaks(primaryPages.refund_history, 'orderId', foreignOrders) &&
          !leaks(primaryPages.refund_history, 'refundId', foreignRefunds) &&
          !leaks(primaryPages.billing_documents, 'paymentId', foreignPayments) &&
          !leaks(primaryPages.billing_documents, 'orderId', foreignOrders) &&
          !leaks(primaryPages.billing_documents, 'documentId', foreignDocuments) &&
          !leaks(foreignPages.payment_history, 'paymentId', primaryPayments) &&
          !leaks(foreignPages.payment_history, 'orderId', primaryOrders) &&
          !leaks(foreignPages.refund_history, 'paymentId', primaryPayments) &&
          !leaks(foreignPages.refund_history, 'orderId', primaryOrders) &&
          !leaks(foreignPages.refund_history, 'refundId', primaryRefunds) &&
          !leaks(foreignPages.billing_documents, 'paymentId', primaryPayments) &&
          !leaks(foreignPages.billing_documents, 'orderId', primaryOrders) &&
          !leaks(foreignPages.billing_documents, 'documentId', primaryDocuments)
        check('cross_account_payment_refund_billing_isolation', isolated, {
          primaryCounts: Object.fromEntries(Object.entries(primaryPages).map(([k, v]) => [k, v.length])),
          foreignCounts: Object.fromEntries(Object.entries(foreignPages).map(([k, v]) => [k, v.length])),
          refundRowsAvailableAcrossQaAccounts: primaryPages.refund_history.length + foreignPages.refund_history.length,
          billingDocumentsAvailableAcrossQaAccounts: primaryPages.billing_documents.length + foreignPages.billing_documents.length,
          foreignIdentifiersLeaked: !isolated,
        })

        const fixtureCoverage = {
          primaryPayment: primaryPages.payment_history.length > 0,
          foreignPayment: foreignPages.payment_history.length > 0,
          refundHistory: primaryPages.refund_history.length + foreignPages.refund_history.length > 0,
          billingDocuments: primaryPages.billing_documents.length + foreignPages.billing_documents.length > 0,
        }
        const fixtureCoveragePass = Object.values(fixtureCoverage).every(Boolean)
        check('qa_fixture_coverage_for_each_billing_security_domain', fixtureCoveragePass, {
          primaryPaymentCount: primaryPages.payment_history.length,
          foreignPaymentCount: foreignPages.payment_history.length,
          refundHistoryCount: primaryPages.refund_history.length + foreignPages.refund_history.length,
          billingDocumentCount: primaryPages.billing_documents.length + foreignPages.billing_documents.length,
          missingFixtures: Object.entries(fixtureCoverage).filter(([, present]) => !present).map(([name]) => name),
        })
        if (!fixtureCoveragePass) result.status = 'BLOCKED_MISSING_BILLING_SECURITY_FIXTURES'

        const foreignPayment = foreignPages.payment_history.find((item) =>
          ['succeeded', 'partially_captured'].includes(item?.status))
        if (!foreignPayment || !/^pay_[A-Za-z0-9]{26}$/.test(foreignPayment.paymentId || '') ||
            !/^[A-Z]{3}$/.test(foreignPayment.currency || '')) {
          result.status = 'BLOCKED_MISSING_FOREIGN_PAYMENT_FIXTURE'
          check('foreign_payment_fixture_available_for_refund_owner_probe', false, {
            foreignPaymentCount: foreignPages.payment_history.length,
          })
        } else {
          const currency = ['USD','EUR','GBP','CAD','AUD','JPY','CHF','XXX','ZZZ'].find((v) => v !== foreignPayment.currency)
          const probe = await request('POST', '/v1/payments/refunds', {
            jar: primary.jar,
            headers: {
              'content-type': 'application/json',
              'Idempotency-Key': `w07-e2e-cross-account-${randomUUID()}`,
            },
            body: JSON.stringify({
              paymentId: foreignPayment.paymentId,
              amountMinor: 1,
              currency,
              reason: 'cross-account security probe',
            }),
          })
          // The mismatched currency makes a broken owner lookup fail closed
          // before refund reservation or any Hyperswitch network request.
          check('cross_account_refund_denied_before_provider_or_write', probe.status === 404 &&
            probe.errorCode === 'RESOURCE_NOT_FOUND', {
            status: probe.status, errorCode: probe.errorCode,
            providerMutationRequested: false, financialMutationRequested: false,
          })
        }
      }

      for (const [name, path] of routes) {
        const r = await request('GET', path + '?limit=1')
        check(`anonymous_${name}_denied`, r.status === 401 || r.status === 403, {
          status: r.status, errorCode: r.errorCode,
        })
      }
      const anonymousRefund = await request('POST', '/v1/payments/refunds', {
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': `w07-e2e-anon-${randomUUID()}`,
        },
        body: JSON.stringify({
          paymentId: 'pay_aaaaaaaaaaaaaaaaaaaaaaaaaa',
          amountMinor: 1, currency: 'USD', reason: 'anonymous security probe',
        }),
      })
      check('anonymous_refund_denied', anonymousRefund.status === 401 || anonymousRefund.status === 403, {
        status: anonymousRefund.status, errorCode: anonymousRefund.errorCode,
      })

      for (const user of [primary, foreign]) {
        const logout = await request('POST', '/v1/auth/logout', { jar: user.jar })
        check(`${user.label}_logout_cleanup`, logout.status === 204, {
          status: logout.status,
          sessionCookieCleared: logout.setCookies.some((v) =>
            /better-auth\.session_token/i.test(v) && /max-age=0|expires=/i.test(v)),
        })
      }
      if (result.status === 'PENDING') result.status = result.checks.every((x) => x.pass) ? 'PASS' : 'FAIL'
      await finish()
    }
  }
} catch (error) {
  result.status = 'FAIL_UNEXPECTED_RUNTIME'
  result.failureClass = error instanceof Error ? error.name : typeof error
  await finish()
}
