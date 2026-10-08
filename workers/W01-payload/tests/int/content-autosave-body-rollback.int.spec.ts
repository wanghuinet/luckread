import { describe, expect, it } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, '..', relative), 'utf8')

describe('autosave body asset rollback', () => {
  it('does not leave an uploaded body asset when the content write fails', () => {
    const composer = read('src/app/(frontend)/publish/PublishComposer.tsx')

    expect(composer).toContain('async function cleanupUploadedBodyAsset(mediaId: string)')
    expect(composer).toContain("'content-body-cleanup:' + mediaId + ':' + crypto.randomUUID()")
    expect(composer).toContain('let rollbackBodyAssetId: string | null = null')
    expect(composer).toContain('rollbackBodyAssetId = uploadedBody.id')
    expect(composer).toContain('if (!response.ok)')
    expect(composer).toContain('rollbackBodyAssetId = null')
    expect(composer).toContain('if (rollbackBodyAssetId) await cleanupUploadedBodyAsset(rollbackBodyAssetId)')
  })

  it('does not delete the body asset after a successful content write', () => {
    const composer = read('src/app/(frontend)/publish/PublishComposer.tsx')
    const successMarker = "rollbackBodyAssetId = null"
    const cleanupMarker = "if (rollbackBodyAssetId) await cleanupUploadedBodyAsset(rollbackBodyAssetId)"

    expect(composer.indexOf(successMarker)).toBeGreaterThan(composer.indexOf("if (!response.ok)"))
    expect(composer.indexOf(cleanupMarker)).toBeGreaterThan(composer.indexOf(successMarker))
  })
})
