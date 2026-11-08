import test from 'node:test'
import assert from 'node:assert/strict'
import { validateD1_02ReleaseState } from './assert-remote-apply-release.mjs'

const reviewRef='contracts/database/neon-d1-02-remote-runner-review.v1.json'
const d1ReviewRef='contracts/database/neon-d1-01-remote-runner-review.v1.json'
const manifest={
  status:'REMOTE_RUNNER_REVIEWED_REMOTE_APPLY_READY',domainId:'D1-02',databaseName:'luckreadpro',
  databaseUuid:'6c342634-97f6-4248-9f4a-85772af4f22c',postgresMajor:18,businessDataImport:false,
  productionCutoverAuthorized:false,remoteApplyReady:true,
  execution:{runnerStatus:'IMPLEMENTED_AND_REVIEWED',remoteApplyReady:true,reviewEvidenceRef:reviewRef}
}
const ledgerContract={
  databaseMap:{'D1-02':'luckreadpro'},remoteApplyReady:false,
  execution:{runnerStatus:'IMPLEMENTED_FOR_D1_01_AND_D1_02_ONLY',remoteApplyReady:false,domainReadiness:{
    'D1-01':{runnerStatus:'IMPLEMENTED_AND_REVIEWED',remoteApplyReady:true,reviewEvidenceRef:d1ReviewRef},
    'D1-02':{runnerStatus:'IMPLEMENTED_AND_REVIEWED',remoteApplyReady:true,reviewEvidenceRef:reviewRef},
    'D1-03':{runnerStatus:'NOT_IMPLEMENTED',remoteApplyReady:false},
    'D1-04':{runnerStatus:'NOT_IMPLEMENTED',remoteApplyReady:false},
    'D1-05':{runnerStatus:'NOT_IMPLEMENTED',remoteApplyReady:false}
  }}
}

test('releases only D1-02 in the exact reviewed schema-only shared-ledger state', () => {
  assert.equal(validateD1_02ReleaseState({manifest,ledgerContract,reviewValid:true}),true)
})

test('fails closed for missing evidence, global enablement or altered D1-02 target', () => {
  assert.equal(validateD1_02ReleaseState({manifest,ledgerContract,reviewValid:false}),false)
  const globallyReady=structuredClone(ledgerContract); globallyReady.remoteApplyReady=true
  assert.equal(validateD1_02ReleaseState({manifest,ledgerContract:globallyReady,reviewValid:true}),false)
  const wrongDatabase=structuredClone(manifest); wrongDatabase.databaseName='luckread'
  assert.equal(validateD1_02ReleaseState({manifest:wrongDatabase,ledgerContract,reviewValid:true}),false)
})

test('keeps D1-03 through D1-05 blocked and rejects missing review refs', () => {
  const unblocked=structuredClone(ledgerContract); unblocked.execution.domainReadiness['D1-03'].remoteApplyReady=true
  assert.equal(validateD1_02ReleaseState({manifest,ledgerContract:unblocked,reviewValid:true}),false)
  const noRef=structuredClone(ledgerContract); delete noRef.execution.domainReadiness['D1-02'].reviewEvidenceRef
  assert.equal(validateD1_02ReleaseState({manifest,ledgerContract:noRef,reviewValid:true}),false)
})
