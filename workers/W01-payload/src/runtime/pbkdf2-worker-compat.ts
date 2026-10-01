export const WORKER_PBKDF2_MAX_ITERATIONS = 100_000

export const clampWorkerPbkdf2Iterations = (iterations: number): number =>
  Math.min(iterations, WORKER_PBKDF2_MAX_ITERATIONS)

export const wrapWorkerPbkdf2 = <
  T extends (...args: any[]) => unknown,
>(
  nativePbkdf2: T,
): T =>
  ((...args: Parameters<T>) => {
    args[2] = clampWorkerPbkdf2Iterations(args[2] as number)
    return nativePbkdf2(...args)
  }) as T
