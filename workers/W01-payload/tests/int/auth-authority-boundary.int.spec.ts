import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const authRoot = resolve(process.cwd(), 'src/app/auth')

const collectFiles = (directory: string): string[] => {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...collectFiles(fullPath))
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(fullPath)
  }
  return files
}

describe('W01 authentication authority boundary', () => {
  it('keeps application auth routes on the W02 Better Auth boundary', () => {
    const forbiddenPatterns = [
      /from ['"]payload['"]/,
      /getPayload\s*\(/,
      /payload\.(auth|login)\s*\(/,
      /forgotPassword\s*\(/,
      /resetPassword\s*\(/,
    ]

    for (const file of collectFiles(authRoot)) {
      const source = readFileSync(file, 'utf8')
      for (const pattern of forbiddenPatterns) {
        expect(source, file + ' matched ' + pattern).not.toMatch(pattern)
      }
    }
  })
})
