export interface RetryContext {
  /** 1 for the first call, 2 for the first retry, and so on. */
  attempt: number
  /** The `signal` passed in the options, if any. */
  signal?: AbortSignal
}

export interface RetryOptions {
  /** How many times to retry after the first call fails. Default: `3`. */
  retries?: number
  /** Delay before the first retry in milliseconds. Default: `100`. */
  minDelay?: number
  /** Delays never get longer than this. Default: `10000`. */
  maxDelay?: number
  /** Each delay is this many times longer than the last one. Default: `2`. */
  factor?: number
  /**
   * Pick a random delay between half and the full delay, so many clients
   * don't all retry at the same moment. Default: `true`.
   */
  jitter?: boolean
  /**
   * Return `false` to stop retrying and throw the error right away, for
   * example on a 404. Default: retry on every error.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean | Promise<boolean>
  /** Called before waiting for each retry. */
  onRetry?: (error: unknown, attempt: number, delay: number) => void
  /** Stops waiting and retrying when aborted. */
  signal?: AbortSignal
}

function validate(name: string, value: number, min: number): void {
  if (!(value >= min) || !Number.isFinite(value)) {
    throw new RangeError(`"${name}" must be a number >= ${min}, got ${value}`)
  }
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('The operation was aborted')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal))
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError(signal!))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Returns the delay before retry number `retry` (starting at 1), without
 * jitter.
 */
export function getDelay(
  retry: number,
  options: Pick<RetryOptions, 'minDelay' | 'maxDelay' | 'factor'> = {}
): number {
  const { minDelay = 100, maxDelay = 10_000, factor = 2 } = options
  return Math.min(maxDelay, minDelay * factor ** (retry - 1))
}

/**
 * Calls `fn` and, if it throws, calls it again after a delay that grows each
 * time. Returns the first successful result, or throws the last error.
 */
export async function retry<T>(
  fn: (context: RetryContext) => T | Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    retries = 3,
    minDelay = 100,
    maxDelay = 10_000,
    factor = 2,
    jitter = true,
    shouldRetry = () => true,
    onRetry,
    signal
  } = options

  validate('retries', retries, 0)
  validate('minDelay', minDelay, 0)
  validate('maxDelay', maxDelay, 0)
  validate('factor', factor, 1)

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw abortError(signal)

    try {
      return await fn({ attempt, signal })
    } catch (error) {
      if (signal?.aborted) throw abortError(signal)
      if (attempt > retries || !(await shouldRetry(error, attempt))) {
        throw error
      }

      let delay = getDelay(attempt, { minDelay, maxDelay, factor })
      if (jitter) delay = delay / 2 + Math.random() * (delay / 2)
      delay = Math.round(delay)

      onRetry?.(error, attempt, delay)
      await sleep(delay, signal)
    }
  }
}

/**
 * Wraps a function so every call to it is retried with `options`.
 */
export function withRetry<A extends unknown[], T>(
  fn: (...args: A) => T | Promise<T>,
  options: RetryOptions = {}
): (...args: A) => Promise<T> {
  return (...args) => retry(() => fn(...args), options)
}
