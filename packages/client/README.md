# x401-zetrix-client

**Part B — Wallet/Holder Client SDK** for the **x401 identity-proof protocol** on Zetrix.

Lets a wallet **answer** a `PROOF-REQUEST` and produce a `PROOF-RESPONSE`. It is
**orchestration, not heavy crypto**:

1. **Parse** the `PROOF-REQUEST` challenge.
2. **Fetch** the DCQL — `GET /v1/presentation/{id}`.
3. **Build the VP** — delegated to an injected `VcProofProvider` (ZID/VC MCP `vp_create`).
4. **Holder-binding sign** the verifier nonce — delegated to an injected `HolderSigner`
   (Wallet BE → softHSM). The SDK never touches a raw key.
5. **Submit** the VP — `POST /v1/presentation/submit`.
6. **Package** the `PROOF-RESPONSE` for the agent to replay to the resource server.

> The resource-server counterpart is **Part A — [`x401-zetrix-server`](../server)**, which
> mints the `PROOF-REQUEST` and verifies the `PROOF-RESPONSE`. The client does NOT verify
> the HMAC — it relays.

## Install

```bash
npm install x401-zetrix-client
```

## Quick example

```ts
import { X401Wallet } from 'x401-zetrix-client'

const wallet = new X401Wallet(
  { network: 'zetrix:testnet' },   // or 'zetrix:mainnet'; or pin { oid4vpBaseUrl: '...' } to override
  { signer, vc, submitAuth },   // injected deps (e.g. from agentic-wallet-mcp)
  // signer: HolderSigner, vc: VcProofProvider, submitAuth?: SubmitAuthProvider
  // vc.createVp must also return presentationSubmission (DIF PE mapping) — the backend
  // requires presentation_submission on POST /submit.
  // submitAuth signs the holder's own Zetrix address → X-Wallet-Public-Key/X-Wallet-Signed-Data
  // (the verifier's WalletAuthenticationFilter requires it on POST /submit; omit if not gated)
)

// One-shot: PROOF-REQUEST header → PROOF-RESPONSE
const proofResponse = await wallet.respondToChallenge(proofRequestHeader, holderDid)
// Replay proofResponse.headerValue as the PROOF-RESPONSE header on the retry.
```

### Granular steps

```ts
const req  = wallet.parseChallenge(proofRequestHeader)
const def  = await wallet.fetchDefinition(req.requestId)
const vp   = await wallet.buildVp(def, holderDid)
const resp = await wallet.submit(def, vp)   // → ProofResponse
```

## Security notes

- **Injected deps never expose keys.** `HolderSigner` / `VcProofProvider` are implemented by
  the consumer (e.g. the agentic-wallet-mcp); the SDK only orchestrates and never handles a
  raw key or verifies the HMAC (it relays the backend's signed result).
- **Verifier-nonce binding (anti-substitution).** The verifier nonce is bound into both the
  VP derivation and the holder-binding signature, so a proof is tied to that challenge.
  `respondToChallenge` additionally rejects a presentation definition whose `nonce` does not
  match the challenge's — a swapped definition can't make the wallet sign the wrong nonce.
  (This cross-check lives in `respondToChallenge`; if you drive the granular steps directly,
  you own comparing `def.nonce` to the challenge's `nonce` before `buildVp`.)
- **Same-origin submit.** The wallet only POSTs to a `responseUri` on the configured
  `oid4vpBaseUrl` origin (off-origin → `SUBMIT_FAILED`), so signature material can't be
  exfiltrated by a spoofed definition.

## Error taxonomy (`X401WalletErrorCode`)

`OID4VP_UNAVAILABLE` (transport) · `MALFORMED_PROOF_REQUEST` (bad challenge) ·
`DEFINITION_FETCH_FAILED` (non-2xx / bad definition / nonce mismatch) · `VP_BUILD_FAILED`
(VP derivation) · `SIGN_FAILED` (holder-binding) · `SUBMIT_FAILED` (submit non-2xx / bad
responseUri / malformed signed result). `X401WalletError.toJSON()` preserves `message` for
structured logs. `oid4vpTimeoutMs` (default 30000) bounds every backend request.

## Example

A runnable sample is in [`examples/wallet-respond.ts`](./examples/wallet-respond.ts).

See the repository [`docs/`](../../docs) for the API reference, configuration, and the
LOCKED wire contract (`docs/08-wire-contract.md`).
