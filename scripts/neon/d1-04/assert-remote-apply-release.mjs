import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateD104RemoteRunnerReview, D104_REVIEW_REF } from './remote-runner-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'), 'utf8'))
const ledger = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
const readiness = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-shared-runner-local-readiness.v1.json'), 'utf8'))
const reviewRecord = JSON.parse(readFileSync(resolve(root, D104_REVIEW_REF), 'utf8'))
const fail = (message) => { throw new Error('D1-04 remote release gate: ' + message) }

export function validateD104ReleaseState({ manifest: manifestValue, ledgerContract, localReadiness, review, reviewValid } = {}) {
  const domains = ledgerContract?.execution?.domainReadiness ?? {}
  const expectedDomains = ['D1-01', 'D1-02', 'D1-03', 'D1-04', 'D1-05']
  const d1_04 = domains['D1-04']
  const otherDomainsUnchanged =
    domains['D1-01']?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    domains['D1-01']?.remoteApplyReady === true &&
    domains['D1-02']?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    domains['D1-02']?.remoteApplyReady === true &&
    ['D1-03','D1-04','D1-05'].every((domain) =>
      domains[domain]?.runnerStatus === 'NOT_IMPLEMENTED' && domains[domain]?.remoteApplyReady === false)
  return reviewValid === true &&
    review?.status === 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS' &&
    review?.remoteApplyReady === true &&
    manifestValue?.domainId === 'D1-04' &&
    manifestValue?.databaseName === 'luckread_finance' &&
    manifestValue?.cloudflareD1DatabaseUuid === '9bfb89a5-fbb5-45b1-a2ee-eab674b0d736' &&
    manifestValue?.postgresMajor === 18 &&
    manifestValue?.remoteApplyReady === false &&
    manifestValue?.businessDataImport === false &&
    manifestValue?.productionCutoverAuthorized === false &&
    manifestValue?.expected?.businessRows === 0 &&
    ledgerContract?.remoteApplyReady === false &&
    ledgerContract?.execution?.remoteApplyReady === false &&
    ledgerContract?.execution?.runnerEntryPoint === 'scripts/neon/run-schema-migrations.mjs' &&
    ledgerContract?.execution?.runnerStatus === 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY' &&
    JSON.stringify(Object.keys(domains).sort()) === JSON.stringify(expectedDomains) &&
    d1_04?.runnerStatus === 'NOT_IMPLEMENTED' &&
    d1_04?.remoteApplyReady === false &&
    otherDomainsUnchanged &&
    localReadiness?.domains?.['D1-04']?.remoteApplyReady === false &&
    localReadiness?.localSharedRunner?.remoteNeonExecutionSupported === false &&
    review?.target?.domainId === 'D1-04' &&
    review?.target?.databaseName === 'luckread_finance' &&
    review?.target?.scope === 'schema-only' &&
    review?.target?.businessDataImport === false &&
    review?.target?.productionCutoverAuthorized === false
}

export function assertD104RemoteApplyReady({ root: repositoryRoot = root, currentHead } = {}) {
  const evidence = validateD104RemoteRunnerReview({ root: repositoryRoot, currentHead })
  const manifestValue = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/database/neon-d1-04-shared-migration-manifest.v1.json'), 'utf8'))
  const ledgerContract = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
  const localReadiness = JSON.parse(readFileSync(resolve(repositoryRoot, 'contracts/database/neon-shared-runner-local-readiness.v1.json'), 'utf8'))
  const review = JSON.parse(readFileSync(resolve(repositoryRoot, D104_REVIEW_REF), 'utf8'))
  if (!evidence.valid) fail('review evidence invalid: ' + evidence.errors.join('; '))
  if (!validateD104ReleaseState({ manifest: manifestValue, ledgerContract, localReadiness, review, reviewValid: evidence.valid })) {
    fail('D1-04 reviewed release record is inconsistent with the original shared ledger and local-only runner contracts')
  }
  return { ready: true, remoteNeonDdlExecuted: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (mode === '--assert-ready') {
    const result = assertD104RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
    console.log('D1_04_REMOTE_SCHEMA_APPLY_RELEASED ' + JSON.stringify(result))
  } else if (mode === '--assert-reviewed-candidate') {
    const result = assertD104RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
    console.log('D1_04_REMOTE_SCHEMA_REVIEW_CANDIDATE_PASS ' + JSON.stringify(result))
  } else if (mode === '--validate-review-state') {
    if (reviewRecord?.status === 'REMOTE_RUNNER_REVIEW_PENDING' &&
        reviewRecord?.remoteApplyReady === false &&
        manifest?.remoteApplyReady === false &&
        ledger?.execution?.domainReadiness?.['D1-04']?.remoteApplyReady === false) {
      console.log('D1_04_REMOTE_SCHEMA_APPLY_BLOCKED_REVIEW_PENDING')
    } else {
      const result = assertD104RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
      console.log('D1_04_REMOTE_SCHEMA_REVIEW_CANDIDATE_PASS ' + JSON.stringify(result))
    }
  } else if (mode === '--expect-blocked') {
    if (reviewRecord?.status !== 'REMOTE_RUNNER_REVIEW_PENDING' ||
        reviewRecord?.remoteApplyReady !== false ||
        manifest?.remoteApplyReady !== false ||
        ledger?.execution?.domainReadiness?.['D1-04']?.remoteApplyReady !== false) {
      fail('D1-04 must remain blocked until the source-pinned independent remote review is merged')
    }
    console.log('D1_04_REMOTE_SCHEMA_APPLY_BLOCKED_REVIEW_PENDING')
  } else {
    fail('select an explicit guard mode: --assert-ready or --expect-blocked')
  }
}
