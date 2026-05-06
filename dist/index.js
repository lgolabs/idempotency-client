/**
 * @lgolabs/idempotency-client — Tiny TypeScript client for the LGO Labs
 * Idempotency API.
 *
 *   import { IdempotencyClient } from '@lgolabs/idempotency-client'
 *
 *   const idem = new IdempotencyClient({
 *     apiUrl: 'https://idempotency.lgolabs.com',
 *     apiKey: process.env.LGOLABS_KEY!,
 *   })
 *
 *   // One-shot — never re-runs the operation on retry
 *   const r = await idem.execute({
 *     key:        'send-welcome-email-user-42',
 *     targetUrl:  'https://your.api/send-email',
 *     payload:    { to: 'user42@example.com', template: 'welcome' },
 *   })
 *   if (r.dedup === 'fresh') { ... }   // first time
 *   else                     { ... }   // every retry returns cached
 */
export class IdempotencyError extends Error {
    code;
    httpStatus;
    body;
    constructor(error, body) {
        super(error.message);
        this.name = 'IdempotencyError';
        this.code = error.code;
        this.httpStatus = error.http_status;
        this.body = body;
    }
}
export class IdempotencyClient {
    apiUrl;
    apiKey;
    xPayment;
    fetchImpl;
    constructor(opts) {
        if (!opts.apiUrl)
            throw new Error('IdempotencyClient: apiUrl is required');
        if (!opts.apiKey && !opts.xPayment) {
            throw new Error('IdempotencyClient: provide apiKey or xPayment');
        }
        this.apiUrl = opts.apiUrl.replace(/\/+$/, '');
        this.apiKey = opts.apiKey;
        this.xPayment = opts.xPayment;
        this.fetchImpl = opts.fetch ?? globalThis.fetch;
    }
    headers(extra = {}) {
        const h = { 'content-type': 'application/json', ...extra };
        if (this.apiKey)
            h.authorization = `Bearer ${this.apiKey}`;
        if (this.xPayment)
            h['X-PAYMENT'] = this.xPayment;
        return h;
    }
    async request(path, init = {}) {
        const r = await this.fetchImpl(`${this.apiUrl}${path}`, {
            method: init.method ?? 'GET',
            headers: { ...this.headers(), ...(init.headers ?? {}) },
            body: init.body,
        });
        const text = await r.text();
        let body;
        try {
            body = text.length ? JSON.parse(text) : null;
        }
        catch {
            body = text;
        }
        if (!r.ok) {
            const errBody = (body ?? {});
            const errObj = typeof errBody.error === 'object' && errBody.error !== null
                ? errBody.error
                : {
                    code: r.status === 402 ? 'payment_required' : 'http_error',
                    message: typeof errBody.error === 'string' ? errBody.error : `HTTP ${r.status}`,
                    http_status: r.status,
                };
            throw new IdempotencyError(errObj, body);
        }
        return body;
    }
    /** Atomically claim an idempotency key. Bookkeeping mode. */
    claim(args) {
        const body = {};
        if (args.namespace !== undefined)
            body.namespace = args.namespace;
        if (args.ttlSeconds !== undefined)
            body.ttl_seconds = args.ttlSeconds;
        return this.request('/v1/claim', {
            method: 'POST',
            headers: { 'Idempotency-Key': args.key },
            body: JSON.stringify(body),
        });
    }
    /** Store the result of a successful operation. Bookkeeping mode. */
    store(args) {
        return this.request('/v1/store', {
            method: 'POST',
            body: JSON.stringify({
                key: args.key,
                lock_token: args.lockToken,
                result: args.result,
                ttl_seconds: args.ttlSeconds,
            }),
        });
    }
    /** Voluntarily release an in-flight claim. */
    release(args) {
        return this.request('/v1/release', {
            method: 'POST',
            body: JSON.stringify({ key: args.key, lock_token: args.lockToken }),
        });
    }
    /** One-shot idempotent HTTP call (recommended). */
    execute(args) {
        return this.request('/v1/execute', {
            method: 'POST',
            body: JSON.stringify({
                key: args.key,
                target_url: args.targetUrl,
                method: args.method,
                payload: args.payload,
                headers: args.headers,
                timeout_seconds: args.timeoutSeconds,
                ttl_seconds: args.ttlSeconds,
                wait_for_in_flight_ms: args.waitForInFlightMs,
            }),
        });
    }
    /** Derive a deterministic idempotency key from a tool-call signature. */
    deriveKey(args) {
        return this.request('/v1/derive-key', {
            method: 'POST',
            body: JSON.stringify(args),
        });
    }
    /** Read-only key inspection. Throws IdempotencyError(http_status=404) on not found. */
    lookup(key) {
        return this.request(`/v1/lookup/${encodeURIComponent(key)}`, { method: 'GET' });
    }
    /**
     * Convenience: run `fn` exactly once for the given key. If a previous run
     * stored a result, returns it. If currently in-flight, polls briefly. If
     * fresh, executes `fn`, stores the result, returns it. Network/runtime
     * errors release the lock so retries can proceed.
     *
     * Most callers should prefer `execute()` (which does this server-side with
     * a target URL). `runOnce` is for in-process functions you can't expose as
     * an HTTP endpoint.
     */
    async runOnce(args) {
        const claim = await this.claim({
            key: args.key,
            namespace: args.namespace,
            ttlSeconds: args.ttlSeconds,
        });
        if (claim.status === 'duplicate') {
            return { dedup: 'duplicate', key: args.key, result: claim.result };
        }
        if (claim.status === 'in_flight') {
            const deadline = Date.now() + (args.waitForInFlightMs ?? 2000);
            while (Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 200));
                const peek = await this.lookup(args.key).catch(() => null);
                if (peek && peek.status === 'stored') {
                    return { dedup: 'duplicate', key: args.key, result: peek.result };
                }
            }
            throw new IdempotencyError({ code: 'in_flight', message: 'still in_flight after wait', http_status: 409 }, null);
        }
        // fresh — we own the operation
        const lockToken = claim.lock_token;
        let result;
        try {
            result = await args.fn();
        }
        catch (e) {
            await this.release({ key: args.key, lockToken }).catch(() => { });
            throw e;
        }
        await this.store({ key: args.key, lockToken, result, ttlSeconds: args.ttlSeconds });
        return { dedup: 'fresh', key: args.key, result };
    }
}
