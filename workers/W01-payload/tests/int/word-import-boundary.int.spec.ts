import { describe, expect, it } from 'vitest'

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (relative: string) => fs.readFileSync(path.resolve(here, '..', relative), 'utf8')

describe('structured Word import boundary', () => {
  it('uses the custom ArticleDocument importer instead of a second Payload Lexical feature', () => {
    const payloadConfig = read('src/payload.config.ts')
    const registry = read('src/components/article-editor-plugins.ts')
    const importer = read('src/components/ArticleWordImportButton.tsx')
    const index = read('src/features/word-import/index.ts')

    expect(payloadConfig).not.toContain("WordImportFeature")
    expect(payloadConfig).toContain("UploadFeature({ enabledCollections: ['media'] })")

    expect(registry).toContain("articleWordImportPlugin")
    expect(importer).toContain("parseDocx")
    expect(importer).toContain("normalizeImportedDocument")
    expect(importer).toContain("articleDocumentFromImportedDocument")

    expect(index).toContain("export { parseDocx } from './docx-parser.js'")
    expect(index).toContain("export { normalizeImportedDocument } from './normalizer.js'")
    expect(index).not.toContain('WordImportFeature')
  })
})
