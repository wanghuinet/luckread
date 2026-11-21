/** Re-emit a W05 response without accidentally attaching an empty body to a bodyless HTTP status. */
export async function relayW05Response(
  response: Response,
  headers: HeadersInit,
): Promise<Response> {
  const bodylessStatus = response.status === 204 || response.status === 205 || response.status === 304
  const body = bodylessStatus ? null : await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    headers,
  })
}
