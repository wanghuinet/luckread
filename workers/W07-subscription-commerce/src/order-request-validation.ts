export type CreateCommerceOrderItem = Readonly<{
  itemRef: string
  quantity: number
}>

export type CreateCommerceOrderRequest = Readonly<{
  items: readonly CreateCommerceOrderItem[]
}>

export type OrderRequestValidationErrorCode = 'VALIDATION_FAILED' | 'PRECONDITION_REQUIRED'

export type OrderRequestValidationError = Readonly<{
  code: OrderRequestValidationErrorCode
  status: 400 | 428
  field: string
}>

export type OrderRequestValidationResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: OrderRequestValidationError }>

export const MAX_ORDER_ITEMS = 50
export const MAX_ORDER_QUANTITY = 10000
export const MAX_ORDER_ITEM_REF_LENGTH = 255
export const MAX_ORDER_IDEMPOTENCY_KEY_LENGTH = 255

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

const invalid = (field: string): OrderRequestValidationResult<never> => ({
  ok: false,
  error: { code: 'VALIDATION_FAILED', status: 400, field },
})

const required = (field: string): OrderRequestValidationResult<never> => ({
  ok: false,
  error: { code: 'PRECONDITION_REQUIRED', status: 428, field },
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype

const hasOnlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean =>
  Object.keys(value).every((key) => allowed.includes(key))

/**
 * Validate the external create-order DTO only. This function does not prove
 * the item exists, is purchasable, has a specific price, or should grant access.
 * Those decisions must be made server-side against the authoritative item owner.
 */
export function validateCreateCommerceOrderRequest(
  input: unknown,
): OrderRequestValidationResult<CreateCommerceOrderRequest> {
  if (!isRecord(input) || !hasOnlyKeys(input, ['items'])) return invalid('body')
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > MAX_ORDER_ITEMS) {
    return invalid('items')
  }

  const seenItemRefs = new Set<string>()
  const items: CreateCommerceOrderItem[] = []

  for (let index = 0; index < input.items.length; index += 1) {
    const candidate: unknown = input.items[index]
    const field = `items[${index}]`
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ['itemRef', 'quantity'])) return invalid(field)

    const itemRef = candidate.itemRef
    if (
      typeof itemRef !== 'string' ||
      itemRef.length < 1 ||
      itemRef.length > MAX_ORDER_ITEM_REF_LENGTH ||
      itemRef !== itemRef.trim() ||
      CONTROL_CHARACTERS.test(itemRef)
    ) return invalid(`${field}.itemRef`)

    if (seenItemRefs.has(itemRef)) return invalid(`${field}.itemRef`)
    seenItemRefs.add(itemRef)

    const quantity = candidate.quantity
    if (
      typeof quantity !== 'number' ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > MAX_ORDER_QUANTITY
    ) return invalid(`${field}.quantity`)

    items.push({ itemRef, quantity })
  }

  return { ok: true, value: { items } }
}

/**
 * Header validation is deliberately separate from request-body validation so
 * route adapters can reject a missing key before any read/write side effect.
 */
export function validateOrderCreateIdempotencyKey(
  value: string | null | undefined,
): OrderRequestValidationResult<string> {
  if (typeof value !== 'string' || value.trim().length === 0) return required('Idempotency-Key')

  const normalized = value.trim()
  if (
    normalized.length > MAX_ORDER_IDEMPOTENCY_KEY_LENGTH ||
    CONTROL_CHARACTERS.test(normalized)
  ) return invalid('Idempotency-Key')

  return { ok: true, value: normalized }
}
