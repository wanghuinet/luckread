export const AUTO_SAVE_DEBOUNCE_MS = 1800
export const AUTO_SAVE_MIN_INTERVAL_MS = 5000

export const computeAutoSaveDelay = (now: number, lastSavedAt: number | null): number => {
  if (lastSavedAt === null) return AUTO_SAVE_DEBOUNCE_MS
  return Math.max(AUTO_SAVE_DEBOUNCE_MS, AUTO_SAVE_MIN_INTERVAL_MS - Math.max(0, now - lastSavedAt))
}
