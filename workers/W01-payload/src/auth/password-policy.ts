export const MIN_PASSWORD_CODE_POINTS = 15
export const MAX_PASSWORD_CODE_POINTS = 128

export function countPasswordCodePoints(value: string): number {
  return Array.from(value).length
}

export function isValidPasswordCodePointLength(value: string): boolean {
  const length = countPasswordCodePoints(value)
  return length >= MIN_PASSWORD_CODE_POINTS && length <= MAX_PASSWORD_CODE_POINTS
}
