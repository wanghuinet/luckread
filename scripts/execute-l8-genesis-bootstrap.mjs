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

    const response = await fetch('https://api.luckread.com/api/v1/admin/bootstrap/super-admin', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + oidcPayload.value,
        'content-type': 'application/json; charset=utf-8',
        accept: 'application/json',
      },
      body: JSON.stringify({ requestPrNumber, githubToken }),
      cache: 'no-store',
    })
    const responseText = await response.text()
    let result
    try { result = JSON.parse(responseText) } catch { result = { error: { code: 'INVALID_RESPONSE' } } }

    if (!response.ok) {
      console.error(JSON.stringify({
        status: response.status,
        error: result?.error?.code ?? 'BOOTSTRAP_FAILED',
        message: 'W02 denied the L8 genesis bootstrap. No further retry should be attempted until the blocker is reviewed.',
      }))
      process.exitCode = 1
    } else {
      console.log(JSON.stringify({ status: 'BOOTSTRAP_RESULT', data: result?.data ?? result }, null, 2))
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : 'L8 bootstrap request failed')
  }
}
