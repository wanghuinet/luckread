import process from 'node:process'

const fail = (message) => {
  console.error(message)
  process.exitCode = 1
}

const requestPrNumber = Number(process.env.REQUEST_PR_NUMBER)
const githubToken = process.env.GITHUB_TOKEN
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN

if (!Number.isSafeInteger(requestPrNumber) || requestPrNumber < 1) {
  fail('REQUEST_PR_NUMBER must be a positive integer.')
} else if (!githubToken || !oidcRequestUrl || !oidcRequestToken) {
  fail('GitHub Actions OIDC context or short-lived GitHub token is unavailable.')
} else {
  try {
    const oidcUrl = new URL(oidcRequestUrl)
    oidcUrl.searchParams.set('audience', 'luckread-w02-l8-bootstrap')
    const oidcResponse = await fetch(oidcUrl, {
      headers: { authorization: 'Bearer ' + oidcRequestToken, accept: 'application/json' },
      cache: 'no-store',
    })
    if (!oidcResponse.ok) throw new Error('GitHub Actions OIDC token issuance failed')
    const oidcPayload = await oidcResponse.json()
    if (typeof oidcPayload.value !== 'string' || oidcPayload.value.length < 100) {
      throw new Error('GitHub Actions returned an invalid OIDC token')
    }

    const postToW01 = async (route) => {
      const response = await fetch('https://api.luckread.com' + route, {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + oidcPayload.value,
          'content-type': 'application/json; charset=utf-8',
          accept: 'application/json',
        },
        body: JSON.stringify({ requestPrNumber, githubToken }),
        cache: 'no-store',
      })
      const text = await response.text()
      let result
      try { result = JSON.parse(text) } catch { result = { error: { code: 'INVALID_RESPONSE' } } }
      return { response, result }
    }

    // One GitHub Environment approval authorizes this run. W02 independently
    // verifies the signed OIDC identity, the single-reviewer environment
    // policy, and the immutable request. Readiness is always checked first;
    // no grant call is made if any read-only precondition fails.
    const preflight = await postToW01('/api/v1/admin/bootstrap/super-admin/readiness')
    const readiness = preflight.result?.data
    if (
      !preflight.response.ok ||
      readiness?.status !== 'READY_FOR_BOOTSTRAP' ||
      readiness?.productionMutationPerformed !== false ||
      readiness?.targetUserId === undefined ||
      readiness?.roleId !== 'super_admin' ||
      readiness?.scopeType !== 'global' ||
      readiness?.maxGrantSeconds !== 14400 ||
      !Array.isArray(readiness?.approvedReviewers) ||
      readiness.approvedReviewers.length !== 1
    ) {
      console.error(JSON.stringify({
        phase: 'READ_ONLY_PREFLIGHT',
        status: preflight.response.status,
        error: preflight.result?.error?.code ?? 'READINESS_CONTRACT_FAILED',
        message: 'Read-only production preflight did not pass. No grant request was sent.',
      }))
      process.exitCode = 1
    } else {
      console.log(JSON.stringify({
        phase: 'READ_ONLY_PREFLIGHT_PASSED',
        status: readiness.status,
        targetUserId: readiness.targetUserId,
        requestPrNumber: readiness.requestPrNumber,
        requestMergeSha: readiness.requestMergeSha,
        approvedReviewer: readiness.approvedReviewers[0],
        maxGrantSeconds: readiness.maxGrantSeconds,
        productionMutationPerformed: false,
      }, null, 2))

      // Same approved run proceeds to the single one-time write only after the
      // preflight passed. W02 repeats all mutable checks and atomically commits.
      const grant = await postToW01('/api/v1/admin/bootstrap/super-admin')
      if (!grant.response.ok) {
        console.error(JSON.stringify({
          phase: 'BOOTSTRAP_WRITE',
          status: grant.response.status,
          error: grant.result?.error?.code ?? 'BOOTSTRAP_FAILED',
          message: 'W02 denied the L8 genesis bootstrap. Do not retry until the blocker is reviewed.',
        }))
        process.exitCode = 1
      } else {
        console.log(JSON.stringify({
          phase: 'BOOTSTRAP_WRITE',
          status: 'BOOTSTRAP_RESULT',
          data: grant.result?.data ?? grant.result,
        }, null, 2))
      }
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : 'L8 bootstrap request failed')
  }
}
