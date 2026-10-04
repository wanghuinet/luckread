export class ContentRuntimeError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code)
  }
}
