# retry-with-backoff

[![npm version](https://img.shields.io/npm/v/retry-with-backoff.svg)](https://www.npmjs.com/package/retry-with-backoff)
[![license](https://img.shields.io/npm/l/retry-with-backoff.svg)](https://www.npmjs.com/package/retry-with-backoff)

Calls a function again when it throws, waiting a bit longer before each new
try. Useful for network requests and other calls that sometimes fail for a
moment.

Works with both `import` and `require`. Requires Node.js 18 or newer. No
dependencies.

## Installation

```console
npm i retry-with-backoff
```

## Usage

```ts
import { retry } from 'retry-with-backoff'

const user = await retry(async () => {
  const response = await fetch('https://api.example.com/user/1')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
})
```

With the default options, the function is called up to 4 times (the first
call and 3 retries). The waits before the retries are about 100, 200 and
400 ms.

### Only retry some errors

```ts
await retry(callApi, {
  retries: 5,
  shouldRetry: (error) => error.status === undefined || error.status >= 500
})
```

When `shouldRetry` returns `false`, the error is thrown right away.

### Log the retries

```ts
await retry(callApi, {
  onRetry: (error, attempt, delay) => {
    console.log(`Attempt ${attempt} failed, trying again in ${delay} ms`)
  }
})
```

### Stop with an AbortSignal

```ts
await retry(({ signal }) => fetch(url, { signal }), {
  signal: AbortSignal.timeout(30_000)
})
```

When the signal is aborted, waiting stops and `retry` throws the abort
reason. The signal is also passed to your function, so you can cancel the
request that's running.

### Wrap a function

```ts
import { withRetry } from 'retry-with-backoff'

const getUser = withRetry((id: number) => api.getUser(id), { retries: 5 })

await getUser(1)
```

## How the delay is calculated

The delay before retry number `n` is `minDelay * factor ** (n - 1)`, but never
more than `maxDelay`. With the defaults that's 100, 200, 400, 800 ... up to
10000 ms.

With `jitter` on (the default), the real delay is a random value between half
of that and the full value. This keeps many clients that failed at the same
time from all retrying at the same moment.

## API

### retry(fn, options?)

- `fn` - `(context) => T | Promise<T>`. `context.attempt` is `1` on the first
  call, `2` on the first retry, and so on. `context.signal` is the `signal`
  from the options.
- `options.retries` - how many times to retry. Default: `3`.
- `options.minDelay` - delay before the first retry in ms. Default: `100`.
- `options.maxDelay` - largest delay in ms. Default: `10000`.
- `options.factor` - how much the delay grows each time. Default: `2`.
- `options.jitter` - use a random delay between half and the full delay.
  Default: `true`.
- `options.shouldRetry` - `(error, attempt) => boolean | Promise<boolean>`.
  Default: retry on every error.
- `options.onRetry` - `(error, attempt, delay) => void`, called before each
  wait.
- `options.signal` - `AbortSignal` to stop retrying.
- Returns: `Promise<T>`, the result of the first call that works.

Throws the error from the last call when all retries fail.

### withRetry(fn, options?)

Returns a new function that calls `fn` with the same arguments, using
`retry`.

### getDelay(retry, options?)

Returns the delay before retry number `retry` without jitter. Takes
`minDelay`, `maxDelay` and `factor`.

## License

ISC
