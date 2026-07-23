# Overview

> Cross-references: §01 for architecture, §03 for flows, §07 for quickstart, §08 for the wire contract.

## What this repo is

`x401-zetrix-js` is the Node.js/TypeScript implementation of the **x401 identity-proof
protocol** for the Zetrix blockchain. x401 identity proof has **two sides**, and each ships
as its own package — mirroring `x402-zetrix-js` (`server` + `client`). Both wrap the Zetrix
**OID4VP backend** and depend on it only at runtime (HTTP).

### Part A — Resource-Server SDK (`x401-zetrix-server`)

Lets any Node API **require and verify** an x401 proof (the `Resource Server (x401 SDK)`
lifeline). It does exactly two things:

1. **Challenge** — mint a verification request against the OID4VP backend (Bearer API key,
   `callbackUrl` omitted → sync-HMAC mode) and return a `401 Proof-Required` response
   carrying a `PROOF-REQUEST`.
2. **Verify** — on the retry, detect and parse the `PROOF-RESPONSE` header and verify the
   relayed result: HMAC (shared callback secret) + timestamp freshness + session binding +
   `verified === true`.

### Part B — Wallet/Holder Client SDK (`x401-zetrix-client`)

Lets a wallet **answer** a `PROOF-REQUEST` and produce a `PROOF-RESPONSE` (the
`Agentic Wallet MCP` lifeline). It is **orchestration, not heavy crypto**: it parses the
challenge, fetches the DCQL, builds the VP (delegated to an injected `VcProofProvider`),
holder-binding signs the verifier nonce (delegated to an injected `HolderSigner`), submits
the VP, and packages the `PROOF-RESPONSE`. The SDK never touches a raw key.

## Package inventory

| Package | npm name | Role |
|---|---|---|
| server | `x401-zetrix-server` | **Part A** — RS verifier: config + validation, models, OID4VP client, challenge builder, HMAC + verify, web adapters (Express / Fastify / framework-agnostic). Zero heavy deps — built-in `fetch` and `node:crypto`. |
| client | `x401-zetrix-client` | **Part B** — wallet/holder: config, models, injected `HolderSigner` + `VcProofProvider`, OID4VP wallet client, VP builder, proof-response packaging. Zero heavy deps. |
| integration | `x401-zetrix-integration` (private) | End-to-end tests running the full challenge → respond → verify loop (both SDKs) against a mock OID4VP backend (msw/nock). |

## Non-goals (by design)

**Part A (server):**
- No wallet / MCP / HSM / Facilitator communication.
- No `GET /v1/presentation/{id}` or `POST /v1/presentation/submit` (those are wallet-side).

**Part B (client):**
- Never verifies the HMAC (that is Part A's job) and never settles payment (x402).
- No proof derivation or holder key handling in-process — both are delegated to injected
  dependencies (`VcProofProvider`, `HolderSigner`).

**Both:**
- No x402 payment, settlement, or combined `401+402` challenge — payment is a separate SDK.
- No credential storage, DCQL matching logic, or SD-JWT / mdoc credential formats.

## Runtime

- Node.js ≥ 18 (built-in `fetch`, `node:crypto`), TypeScript, ships `.d.ts`.
- Server framework adapters (`express`, `fastify`) are **optional peer dependencies**.
- The client injects `HolderSigner` + `VcProofProvider` (wired in by the consumer).
