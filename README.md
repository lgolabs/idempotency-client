# @lgolabs/idempotency-client

TypeScript client for the [LGO Labs Idempotency API](https://idempotency.lgolabs.com).

## Install

```bash
npm i @lgolabs/idempotency-client
```

## Three patterns

### A. One-shot (recommended)

We claim the key, call your URL once, cache the response, replay on every retry of the same key.

```ts
import { IdempotencyClient } from '@lgolabs/idempotency-client'

const idem = new IdempotencyClient({
  apiUrl: 'https://idempotency.lgolabs.com',
  apiKey: process.env.LGOLABS_KEY!,
})

const r = await idem.execute({
  key:        'send-welcome-email-user-42',
  targetUrl:  'https://your.api/send-email',
  payload:    { to: 'user42@example.com', template: 'welcome' },
})

if (r.dedup === 'fresh') console.log('first time:', r.upstream.body)
else                     console.log('cached:',     r.upstream.body)
```

### B. Wrap an in-process function

Same idempotency guarantee, but the operation runs in your process (useful when you can't expose `target_url`).

```ts
const r = await idem.runOnce({
  key: 'process-invoice-INV-001',
  fn:  async () => await heavyComputation(),
})
// r.result is the cached value on retry
```

### C. Manual claim/store (for advanced flows)

```ts
const c = await idem.claim({ key: 'k1' })
if (c.status === 'fresh') {
  const out = await yourOperation()
  await idem.store({ key: 'k1', lockToken: c.lock_token, result: out })
}
```

## Errors

All non-2xx responses throw `IdempotencyError` with structured fields:

```ts
import { IdempotencyError } from '@lgolabs/idempotency-client'

try {
  await idem.execute({ ... })
} catch (e) {
  if (e instanceof IdempotencyError) {
    console.log(e.code, e.httpStatus, e.message)
  }
}
```

## Pay-per-call (x402)

Pass a signed `xPayment` header value instead of `apiKey`. The API responds with 402 + payment requirements per [x402.org](https://www.x402.org), your wallet signs a USDC transfer on Base, you retry with the signed payload, and the request goes through. No signup.

```ts
const idem = new IdempotencyClient({
  apiUrl: 'https://idempotency.lgolabs.com',
  xPayment: signedX402Header,  // alternative to apiKey
})
```

Free tier: 500 calls/day. Beyond that, 1000 atomic micro-USDC ($0.001) per call.

## API reference

Full spec: [`idempotency.lgolabs.com/openapi.yaml`](https://idempotency.lgolabs.com/openapi.yaml).

## License

MIT.
