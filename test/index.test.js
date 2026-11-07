/* global AbortController, AbortSignal, setTimeout */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { getDelay, retry, withRetry } from '../dist/index.js'

const fast = { minDelay: 1, maxDelay: 5 }

// Returns a function that fails `times` times and then returns 'ok'.
function failing(times) {
  let calls = 0
  const fn = () => {
    calls++
    if (calls <= times) throw new Error(`fail ${calls}`)
    return 'ok'
  }
  fn.calls = () => calls
  return fn
}

test('returns the result without retrying when it works', async () => {
  const fn = failing(0)
  assert.equal(await retry(fn, fast), 'ok')
  assert.equal(fn.calls(), 1)
})

test('retries until it works', async () => {
  const fn = failing(2)
  assert.equal(await retry(fn, fast), 'ok')
  assert.equal(fn.calls(), 3)
})

test('throws the last error after all retries', async () => {
  const fn = failing(10)
  await assert.rejects(retry(fn, { ...fast, retries: 2 }), /fail 3/)
  assert.equal(fn.calls(), 3)
})

test('retries: 0 calls only once', async () => {
  const fn = failing(10)
  await assert.rejects(retry(fn, { retries: 0 }), /fail 1/)
  assert.equal(fn.calls(), 1)
})

test('works with async functions and passes the attempt', async () => {
  const attempts = []
  const result = await retry(async ({ attempt }) => {
    attempts.push(attempt)
    if (attempt < 3) throw new Error('not yet')
    return attempt
  }, fast)
  assert.equal(result, 3)
  assert.deepEqual(attempts, [1, 2, 3])
})

test('shouldRetry can stop retrying', async () => {
  const fn = failing(10)
  await assert.rejects(
    retry(fn, { ...fast, shouldRetry: (error) => error.message !== 'fail 2' }),
    /fail 2/
  )
  assert.equal(fn.calls(), 2)
})

test('onRetry gets the error, attempt and delay', async () => {
  const calls = []
  await retry(failing(2), {
    minDelay: 10,
    jitter: false,
    onRetry: (error, attempt, delay) =>
      calls.push([error.message, attempt, delay])
  })
  assert.deepEqual(calls, [
    ['fail 1', 1, 10],
    ['fail 2', 2, 20]
  ])
})

test('jitter keeps the delay between half and the full delay', async () => {
  const delays = []
  await retry(failing(5), {
    retries: 5,
    minDelay: 4,
    onRetry: (_, attempt, delay) => delays.push([attempt, delay])
  })
  for (const [attempt, delay] of delays) {
    const full = getDelay(attempt, { minDelay: 4 })
    assert.ok(delay >= full / 2 && delay <= full, `${delay} of ${full}`)
  }
})

test('getDelay grows and stops at maxDelay', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((n) => getDelay(n, { minDelay: 100, maxDelay: 500 })),
    [100, 200, 400, 500, 500]
  )
  assert.equal(getDelay(3, { minDelay: 10, factor: 3 }), 90)
})

test('stops when the signal is aborted', async () => {
  const controller = new AbortController()
  const fn = failing(10)
  const promise = retry(fn, { minDelay: 1000, signal: controller.signal })
  setTimeout(() => controller.abort(new Error('stop')), 20)

  const start = Date.now()
  await assert.rejects(promise, /stop/)
  assert.ok(Date.now() - start < 500)
  assert.equal(fn.calls(), 1)
})

test('throws right away when the signal is already aborted', async () => {
  const fn = failing(0)
  await assert.rejects(
    retry(fn, { signal: AbortSignal.abort(new Error('already')) }),
    /already/
  )
  assert.equal(fn.calls(), 0)
})

test('withRetry wraps a function', async () => {
  let calls = 0
  const add = withRetry((a, b) => {
    if (++calls < 2) throw new Error('flaky')
    return a + b
  }, fast)
  assert.equal(await add(2, 3), 5)
})

test('throws on invalid options', async () => {
  await assert.rejects(retry(failing(0), { retries: -1 }), RangeError)
  await assert.rejects(retry(failing(0), { factor: 0.5 }), RangeError)
})

test('CommonJS build works', async () => {
  const cjs = createRequire(import.meta.url)('../dist/index.cjs')
  assert.equal(await cjs.retry(failing(1), fast), 'ok')
})
