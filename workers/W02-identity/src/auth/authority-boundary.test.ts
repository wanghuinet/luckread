import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const sourceRoot = resolve(process.cwd(), 'src')

const collectSourceFiles = (directory: string): string[] => {
  const files: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }

    if (entry.isFile() && /\\.(mjs|cjs|js|ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) {
      files.push(fullPath)
    }
  }

  return files
}

describe('W02 identity authority boundary', () => {
  it('does not use the legacy Payload users/users_sessions persistence from production source', () => {
    const forbiddenPatterns = [
      /\\bFROM\\s+users\\b/i,
      /\\bUPDATE\\s+users\\b/i,
      /\\bDELETE\\s+FROM\\s+users\\b/i,
      /\\bINSERT\\s+INTO\\s+users\\b/i,
      /\\busers_sessions\\b/i,
    ]

    for (const file of collectSourceFiles(sourceRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of forbiddenPatterns) {
        expect(source, file + ' matched ' + pattern).not.toMatch(pattern)
      }
    }
  })
})
