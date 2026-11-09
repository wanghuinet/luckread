import test from 'node:test'
import assert from 'node:assert/strict'
import { validateD1_02RemoteRunnerReview } from './remote-runner-review.mjs'

const reviewedFiles = [
  '.github/workflows/neon-d1-02-full-local-rehearsal.yml',
  '.github/workflows/neon-w03-d1-02-postgres-schema.yml',
  'contracts/database/neon-d1-02-combined-schema.v1.json',
  'contracts/database/neon-d1-02-schema-sources.v1.json',
  'scripts/neon/d1-02/assert-remote-apply-release.test.mjs',
  'scripts/neon/d1-02/verify-combined-schema-contract.test.mjs',
  'workers/W03-content/src/neon-postgres-migrations/0002_w03_d1_02_content_snowflake_timestamp_bigint.sql',
  'workers/W03-content/scripts/neon/verify-d1-02-content-postgres-schema.sql',
  'workers/W03-content/migrations/0012_content_snowflake_id_allocator.sql',
  'workers/W03-content/src/content-snowflake-id.ts',
  '.github/workflows/neon-d1-02-reviewed-remote-schema-apply.yml',
  'contracts/database/neon-d1-02-migration-manifest.v1.json',
  'contracts/database/neon-schema-migration-ledger.v1.json',
  'scripts/neon/d1-02/assert-remote-apply-release.mjs',
  'scripts/neon/d1-02/schema-only-runner.mjs',
  'scripts/neon/d1-02/schema-only-runner.test.mjs',
  'scripts/neon/d1-01/0001_schema_migration_ledger.sql',
  'workers/W03-content/src/neon-postgres-migrations/0001_w03_d1_02_content_schema.sql',
  'workers/W05-social/src/neon-postgres-migrations/0001_w05_d1_02_social_schema.sql',
  'scripts/neon/d1-02/verify-combined-postgres-schema.sql',
  'scripts/neon/d1-02/verify-combined-schema-contract.mjs',
  'scripts/neon/run-schema-migrations.mjs',
  'scripts/neon/run-schema-migrations.test.mjs',
  'scripts/neon/d1-01-migration-manifest.mjs',
  'scripts/neon/plan-d1-01-schema-migrations.mjs',
  'scripts/neon/assert-d1-01-migration-ledger-ready.mjs',
]
const sha = 'a'.repeat(40)
const review = {
  status: 'AI_REVIEW_PASS_NO_BLOCKING_FINDINGS',
  repository: 'wanghuinet/luckread',
  target: { domainId:'D1-02', databaseName:'luckreadpro', databaseUuid:'6c342634-97f6-4248-9f4a-85772af4f22c', neonHost:'ep-icy-breeze-azdp8x8q-pooler.c-3.ap-southeast-1.aws.neon.tech', postgresMajor:18, scope:'schema-only', businessDataImport:false, productionCutoverAuthorized:false },
  review: {
    reviewer:'GPT-6',
    reviewType:'GPT-6 code-path audit plus current-main SHA and CI evidence reconciliation',
    reviewedAt:'2026-11-09',
    reviewedMainSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',
    implementationMergeSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',
    result:'NO_BLOCKING_FINDINGS',
    formalGitHubReviewSubmissions:0,
    findings:[],
    limitations:[
      'PR #1643 had no submitted GitHub review records; this is a GPT-6 review record, not a human approval.',
      'Remote Neon DDL has not been executed.',
      'GitHub repository secrets cannot be enumerated by this review tool.',
      'The database UUID is pinned as user-provided Neon metadata; the PostgreSQL protocol does not expose this UUID as a SQL identity field.'
    ],
    reviewedFiles:reviewedFiles.map(path=>({path,gitBlobSha1:sha})),
  },
  verificationEvidence:{
    fullD1_02LocalPostgres18Rehearsal:{runId:42612620258,headSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',conclusion:'success',url:'https://github.com/wanghuinet/luckread/actions/runs/42612620258'},
    remoteRunnerGuardsNoCredentials:{runId:42612620075,headSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',conclusion:'success',url:'https://github.com/wanghuinet/luckread/actions/runs/42612620075',remoteApplyJob:'skipped'},
    contractAdmission:{runId:42612620125,headSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',conclusion:'success',url:'https://github.com/wanghuinet/luckread/actions/runs/42612620125'},
    mapping0StructuralGate:{runId:42612620155,headSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',conclusion:'success',url:'https://github.com/wanghuinet/luckread/actions/runs/42612620155'},
    featureInventory:{runId:42612620321,headSha:'8a0db7dd0d0567131d51e009302465f8e30b9386',conclusion:'success',url:'https://github.com/wanghuinet/luckread/actions/runs/42612620321'}
  },
  safety:{remoteNeonDdlExecuted:false,cloudflareD1Touched:false,businessDataImported:false,productionCutoverAuthorized:false,manualWorkflowDispatchRequired:true,exactConfirmationRequired:'APPLY_REVIEWED_SCHEMA_D1_02_LUCKREADPRO'}
}

test('accepts the exact reviewed D1-02 schema-only implementation and current-main CI evidence', () => {
  const result = validateD1_02RemoteRunnerReview({ review, currentHead: 'b'.repeat(40), hashBlob:()=>sha, isAncestor:()=>true })
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('rejects source drift, non-ancestor review and mismatched evidence', () => {
  assert.equal(validateD1_02RemoteRunnerReview({ review, currentHead:'b'.repeat(40), hashBlob:()=> 'f'.repeat(40), isAncestor:()=>true }).valid, false)
  assert.equal(validateD1_02RemoteRunnerReview({ review, currentHead:'b'.repeat(40), hashBlob:()=>sha, isAncestor:()=>false }).valid, false)
  const badEvidence=structuredClone(review)
  badEvidence.verificationEvidence.contractAdmission.runId=1
  assert.equal(validateD1_02RemoteRunnerReview({ review:badEvidence, currentHead:'b'.repeat(40), hashBlob:()=>sha, isAncestor:()=>true }).valid, false)
})

test('rejects any assertion that remote DDL or business data import already happened', () => {
  const bad=structuredClone(review)
  bad.safety.businessDataImported=true
  assert.equal(validateD1_02RemoteRunnerReview({ review:bad, currentHead:'b'.repeat(40), hashBlob:()=>sha, isAncestor:()=>true }).valid, false)
})
