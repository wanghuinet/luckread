import { describe, expect, it } from 'vitest'
import {
  AUTO_SAVE_DEBOUNCE_MS,
  AUTO_SAVE_MIN_INTERVAL_MS,
  computeAutoSaveDelay,
} from './content-autosave.js'

describe('content autosave policy', () => {
  it('debounces the first autosave', () => {
    expect(computeAutoSaveDelay(1000, null)).toBe(AUTO_SAVE_DEBOUNCE_MS)
  })

  it('never saves more frequently than the minimum interval', () => {
    expect(computeAutoSaveDelay(3000, 1000)).toBe(AUTO_SAVE_MIN_INTERVAL_MS - 2000)
    expect(computeAutoSaveDelay(9000, 1000)).toBe(AUTO_SAVE_DEBOUNCE_MS)
  })

  it('does not lengthen the delay when the previous save is already old', () => {
    expect(computeAutoSaveDelay(20000, 1000)).toBe(AUTO_SAVE_DEBOUNCE_MS)
  })
})
