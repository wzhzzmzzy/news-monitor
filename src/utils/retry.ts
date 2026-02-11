import logger from './logger.js'

export interface RetryOptions {
  retries: number
  factor: number
  minTimeout: number
  maxTimeout: number
}

const defaultOptions: RetryOptions = {
  retries: 1,
  factor: 2,
  minTimeout: 1000,
  maxTimeout: 10000,
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...defaultOptions, ...options }
  let lastError: Error | unknown

  for (let i = 0; i <= opts.retries; i++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (i === opts.retries) break

      const timeout = Math.min(
        opts.minTimeout * Math.pow(opts.factor, i),
        opts.maxTimeout
      )

      logger.warn(`Task failed, retrying in ${timeout}ms... (Attempt ${i + 1}/${opts.retries})`)
      logger.debug(error)

      await new Promise((resolve) => setTimeout(resolve, timeout))
    }
  }

  throw lastError
}
