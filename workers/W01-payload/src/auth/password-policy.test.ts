import { describe, expect, it } from 'vitest'
import {
  countPasswordCodePoints,
  isValidPasswordCodePointLength,
} from './password-policy.js'

describe('password Unicode code-point policy', () => {
  it('counts supplementary Unicode characters as one code point each', () => {
    expect(countPasswordCodePoints('😀'.repeat(15))).toBe(15)
    expect(countPasswordCodePoints('a😀b')).toBe(3)
  })

  it('accepts the inclusive 15 to 128 code-point range', () => {
    expect(isValidPasswordCodePointLength('😀'.repeat(14))).toBe(false)
    expect(isValidPasswordCodePointLength('😀'.repeat(15))).toBe(true)
    expect(isValidPasswordCodePointLength('😀'.repeat(128))).toBe(true)
    expect(isValidPasswordCodePointLength('😀'.repeat(129))).toBe(false)
  })

  it('counts combining marks as separate Unicode code points', () => {
    expect(countPasswordCodePoints('e\u0301'.repeat(8))).toBe(16)
    expect(isValidPasswordCodePointLength('e\u0301'.repeat(8))).toBe(true)
  })
})
