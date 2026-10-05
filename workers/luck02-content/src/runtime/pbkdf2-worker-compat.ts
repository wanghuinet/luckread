export const WORKER_PBKDF2_MAX_ITERATIONS = 100_000

export const clampWorkerPbkdf2Iterations = (iterations: number): number =>
  Math.min(iterations, WORKER_PBKDF2_MAX_ITERATIONS)
