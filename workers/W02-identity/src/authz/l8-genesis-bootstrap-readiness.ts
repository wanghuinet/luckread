export class L8BootstrapReadinessError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'L8BootstrapReadinessError'
  }
}
