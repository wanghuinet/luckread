import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateD1_02RemoteRunnerReview, D1_02_REVIEW_EVIDENCE_REF } from './remote-runner-review.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const manifest = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-d1-02-migration-manifest.v1.json'), 'utf8'))
const ledgerContract = JSON.parse(readFileSync(resolve(root, 'contracts/database/neon-schema-migration-ledger.v1.json'), 'utf8'))
const fail = (message) => { throw new Error('D1-02 remote release gate: ' + message) }

export function validateD1_02ReleaseState({ manifest: manifestValue, ledgerContract: ledgerValue, reviewValid } = {}) {
  const domains = ledgerValue?.execution?.domainReadiness ?? {}
  const expectedDomains = ['D1-01', 'D1-02', 'D1-03', 'D1-04', 'D1-05']
  const d1_01 = domains['D1-01']
  const d1_02 = domains['D1-02']
  const laterDomainsBlocked = ['D1-03', 'D1-04', 'D1-05'].every((domain) =>
    domains[domain]?.runnerStatus === 'NOT_IMPLEMENTED' && domains[domain]?.remoteApplyReady === false)
  return reviewValid === true &&
    manifestValue?.status === 'REMOTE_RUNNER_REVIEWED_REMOTE_APPLY_READY' &&
    manifestValue?.domainId === 'D1-02' &&
    manifestValue?.databaseName === 'luckreadpro' &&
    manifestValue?.databaseUuid === '6c342634-97f6-4248-9f4a-85772af4f22c' &&
    manifestValue?.postgresMajor === 18 &&
    manifestValue?.businessDataImport === false &&
    manifestValue?.productionCutoverAuthorized === false &&
    manifestValue?.remoteApplyReady === true &&
    manifestValue?.execution?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    manifestValue?.execution?.remoteApplyReady === true &&
    manifestValue?.execution?.reviewEvidenceRef === D1_02_REVIEW_EVIDENCE_REF &&
    ledgerValue?.databaseMap?.['D1-02'] === 'luckreadpro' &&
    ledgerValue?.remoteApplyReady === false &&
    ledgerValue?.execution?.remoteApplyReady === false &&
    ledgerValue?.execution?.runnerStatus === 'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY' &&
    JSON.stringify(Object.keys(domains).sort()) === JSON.stringify(expectedDomains) &&
    d1_01?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    d1_01?.remoteApplyReady === true &&
    d1_01?.reviewEvidenceRef === 'contracts/database/neon-d1-01-remote-runner-review.v1.json' &&
    d1_02?.runnerStatus === 'IMPLEMENTED_AND_REVIEWED' &&
    d1_02?.remoteApplyReady === true &&
    d1_02?.reviewEvidenceRef === D1_02_REVIEW_EVIDENCE_REF &&
    laterDomainsBlocked
}

export function assertD1_02RemoteApplyReady({ root: repositoryRoot = root, currentHead } = {}) {
  const evidence = validateD1_02RemoteRunnerReview({ root: repositoryRoot, currentHead })
  if (!evidence.valid) fail('review evidence invalid: ' + evidence.errors.join('; '))
  const ready = validateD1_02ReleaseState({ manifest, ledgerContract, reviewValid: evidence.valid })
  if (!ready) fail('manifest and shared ledger do not encode the exact reviewed D1-02 release state')
  return { ready, evidence: evidence.valid, remoteNeonDdlExecuted: false }
}

if (process.argv[2] === '--assert-ready' || process.argv[2] === '--assert-configured') {
  const result = assertD1_02RemoteApplyReady({ currentHead: process.env.GITHUB_SHA || undefined })
  console.log('D1_02_REMOTE_SCHEMA_APPLY_RELEASED ' + JSON.stringify(result))
} else {
  fail('Select --assert-configured or --assert-ready')
}
