export type ApiErrorPayload = {
  error?: {
    message?: string
    code?: string
  }
}

export type JsonResponse<T> = {
  response: Response
  data: T | null
}

export async function readJson<T = unknown>(response: Response): Promise<T | null> {
  return response.json().catch((): null => null) as Promise<T | null>
}

export async function fetchJson<T = unknown>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<JsonResponse<T>> {
  const response = await fetch(input, init)
  return {
    response,
    data: await readJson<T>(response),
  }
}

export function getApiErrorMessage(
  data: ApiErrorPayload | null | undefined,
  fallback: string,
): string {
  const message = data?.error?.message
  return typeof message === 'string' && message.trim() ? message : fallback
}

export function jsonHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra)
  if (!headers.has('accept')) headers.set('accept', 'application/json')
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  return headers
}
