# x401-zetrix-server

**Part A — Resource-Server SDK** for the **x401 identity-proof protocol** on Zetrix.

Wraps the Zetrix OID4VP backend so any Node API can **require and verify** an x401 proof:

1. **Challenge** — `X401Verifier.challenge()` mints a verification request and returns a
   `401 Proof-Required` carrying a `PROOF-REQUEST` header.
2. **Verify** — `X401Verifier.verify()` parses the `PROOF-RESPONSE` on the retry and
   verifies HMAC (shared callback secret) + timestamp freshness + session binding + status.

> The wallet/holder counterpart is **Part B — [`x401-zetrix-client`](../client)**, which
> answers a `PROOF-REQUEST` and produces the `PROOF-RESPONSE`.

## Install

```bash
npm install x401-zetrix-server
# Optional framework adapters (peer deps — install only what you use):
npm install express   # for requireProof()
npm install fastify   # for x401Plugin
```

## Quick example (Express)

The x401 proof is a **one-shot handshake**, not a per-request credential — gate a dedicated
exchange endpoint with `requireProof`, then issue your own session for subsequent requests:

```ts
import express from 'express'
import { X401Verifier, requireProof } from 'x401-zetrix-server'

const verifier = new X401Verifier({
  network: 'zetrix:testnet',   // resolves oid4vpBaseUrl to the sandbox; use 'zetrix:mainnet' for production
  apiKey: process.env.X401_API_KEY!,
  callbackSecret: process.env.X401_CALLBACK_SECRET!,
})
// Or pin the URL explicitly (overrides `network`):
//   new X401Verifier({ oid4vpBaseUrl: 'https://zid-oid4vp-sandbox.zetrix.com/api', apiKey, callbackSecret })

const app = express()

// Prove once → exchange the verified proof for a session (cookie/JWT).
app.post('/x401/session', requireProof(verifier, { /* CredentialRequirements */ }), (req, res) => {
  const session = issueSession((req as any).x401Claims)  // your session/JWT
  res.json({ session })
})

// Subsequent requests authorize with the session, not a re-presented proof.
app.get('/protected', requireSession, (req, res) => res.json({ ok: true }))
```

On the exchange retry the middleware verifies the `PROOF-RESPONSE` and either proceeds
(claims on `req.x401Claims`) or rejects with **`403`** + a `PROOF-RESULT` `{ code, message }`
body. Fastify is supported via `x401Plugin`; framework-agnostic helpers `handleChallenge` /
`handleVerify` are available for other stacks. Full runnable sample:
[`examples/express-resource-server.ts`](./examples/express-resource-server.ts).

> **Why the hand-off?** With the opt-in replay guard each `PROOF-RESPONSE` is single-use, so
> gating a *persistent* route with `requireProof` directly would reject the caller's second
> request. Prove once, then carry a normal session.

> **Fastify note:** `x401Plugin` registers an `onRequest` hook that gates routes **in its
> own encapsulation scope**. Register it inside the scope whose routes you want protected.

## Session binding (read before production)

By default the middleware **self-binds**: it verifies the `PROOF-RESPONSE` against the
`presentationId` carried in that same response. HMAC, freshness, and status are still
enforced, but there is **no cross-request session binding** — a valid, correctly-signed
`PROOF-RESPONSE` captured elsewhere can be replayed within its freshness window
(default ±`DEFAULT_PROOF_RESPONSE_TTL_SEC` = 300 s).

For true per-session binding, pass `resolveExpectedRequestId(req)` to return the
`request_id` the resource server issued for this session:

```ts
requireProof(verifier, requirements, {
  resolveExpectedRequestId: (req) => req.session?.x401RequestId,
})
```

## Hardening (opt-in)

```ts
import { X401Verifier, InMemoryReplayGuard, DEFAULT_PROOF_RESPONSE_TTL_SEC } from 'x401-zetrix-server'

const verifier = new X401Verifier(config, {
  // Reject a PROOF-RESPONSE replayed within its freshness window.
  // In-memory is process-local — supply a shared (e.g. Redis) ReplayGuard for a cluster.
  replayGuard: new InMemoryReplayGuard(DEFAULT_PROOF_RESPONSE_TTL_SEC * 1000),
  // Audit hook — receives { allowed, requestId, code }; never secrets or claims.
  onVerify: (event) => logger.info({ x401: event }),
})
```

A replayed `request_id` is rejected with `SESSION_MISMATCH`. A throwing `onVerify` never
affects the verification result.

## Example

A runnable Express resource server is in [`examples/express-resource-server.ts`](./examples/express-resource-server.ts).

See the repository [`docs/`](../../docs) for the API reference, configuration, and the
LOCKED wire contract (`docs/08-wire-contract.md`).
