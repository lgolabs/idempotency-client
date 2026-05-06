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
export type IdempotencyClientOptions = {
    apiUrl: string;
    /** API key, OR set xPayment to pay-per-call via x402. */
    apiKey?: string;
    /** Pre-signed x402 X-PAYMENT header value (alternative to apiKey). */
    xPayment?: string;
    /** Override fetch impl (for tests / non-Node runtimes). */
    fetch?: typeof fetch;
};
export type ClaimResult = {
    status: 'fresh';
    key: string;
    lock_token: string;
    claimed_at: string;
} | {
    status: 'in_flight';
    key: string;
    claimed_at: string;
    claim_age_seconds: number;
} | {
    status: 'duplicate';
    key: string;
    result: unknown;
    first_seen_at: string;
};
export type StoreResult = {
    status: 'stored';
    key: string;
    stored_at: string;
};
export type ReleaseResult = {
    status: 'released';
    key: string;
};
export type LookupResult = {
    status: 'stored';
    key: string;
    result: unknown;
    first_seen_at: string;
} | {
    status: 'in_flight';
    key: string;
    first_seen_at: string;
    claim_age_seconds: number;
};
export type DeriveKeyResult = {
    key: string;
    digest_algorithm: 'sha256';
    digest_full: string;
    canonical_input: string;
};
export type ExecuteResult = {
    dedup: 'fresh' | 'duplicate';
    key: string;
    first_seen_at?: string;
    upstream: {
        status: number;
        body: unknown;
        headers: Record<string, string>;
        duration_ms?: number;
    };
};
export type StructuredError = {
    code: string;
    message: string;
    http_status: number;
};
export declare class IdempotencyError extends Error {
    readonly code: string;
    readonly httpStatus: number;
    readonly body: unknown;
    constructor(error: StructuredError, body: unknown);
}
export type ClaimArgs = {
    key: string;
    namespace?: string;
    ttlSeconds?: number;
};
export type StoreArgs = {
    key: string;
    lockToken: string;
    result: unknown;
    ttlSeconds?: number;
};
export type ReleaseArgs = {
    key: string;
    lockToken: string;
};
export type DeriveKeyArgs = {
    operation: string;
    inputs: Record<string, unknown>;
    scope?: string;
};
export type ExecuteArgs = {
    key: string;
    targetUrl: string;
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    payload?: unknown;
    headers?: Record<string, string>;
    timeoutSeconds?: number;
    ttlSeconds?: number;
    waitForInFlightMs?: number;
};
export declare class IdempotencyClient {
    private readonly apiUrl;
    private readonly apiKey?;
    private readonly xPayment?;
    private readonly fetchImpl;
    constructor(opts: IdempotencyClientOptions);
    private headers;
    private request;
    /** Atomically claim an idempotency key. Bookkeeping mode. */
    claim(args: ClaimArgs): Promise<ClaimResult>;
    /** Store the result of a successful operation. Bookkeeping mode. */
    store(args: StoreArgs): Promise<StoreResult>;
    /** Voluntarily release an in-flight claim. */
    release(args: ReleaseArgs): Promise<ReleaseResult>;
    /** One-shot idempotent HTTP call (recommended). */
    execute(args: ExecuteArgs): Promise<ExecuteResult>;
    /** Derive a deterministic idempotency key from a tool-call signature. */
    deriveKey(args: DeriveKeyArgs): Promise<DeriveKeyResult>;
    /** Read-only key inspection. Throws IdempotencyError(http_status=404) on not found. */
    lookup(key: string): Promise<LookupResult>;
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
    runOnce<T>(args: {
        key: string;
        fn: () => Promise<T>;
        namespace?: string;
        ttlSeconds?: number;
        /** How long to wait for an in-flight claim before giving up (default 2s). */
        waitForInFlightMs?: number;
    }): Promise<{
        dedup: 'fresh' | 'duplicate';
        key: string;
        result: T;
    }>;
}
