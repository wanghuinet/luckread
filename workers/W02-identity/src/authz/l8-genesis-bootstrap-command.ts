export class L8BootstrapCommandError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'L8BootstrapCommandError'
  }
}
