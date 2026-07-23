# Architecture

> Cross-references: §00 for scope, §03 for flows, §04/§05 for the API surfaces.

## Two SDKs, one per side of the flow

x401 identity proof has two roles. Each ships as its own package, and the two never share a
process — they communicate only through the LOCKED wire contract (§08).

```
   ┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
   │        Resource Server (your API)     │        │        Wallet / Agentic MCP           │
   │  ┌────────────────────────────────┐   │  401   │  ┌────────────────────────────────┐   │
   │  │       x401-zetrix-server        │◀──┼────────┼──│       x401-zetrix-client        │   │
   │  │  X401Verifier                   │───┼────────┼─▶│  X401Wallet                     │   │
   │  │  challenge() / verify()         │   │  retry │  │  respondToChallenge()           │   │
   │  └───────────────┬────────────────┘   │  +resp │  └───────────────┬────────────────┘   │
   └──────────────────│────────────────────┘        └──────────────────│────────────────────┘
                      │ POST /v1/verification/request                    │ GET  /v1/presentation/{id}
                      │  (only backend call Part A makes)                │ POST /v1/presentation/submit
                      ▼                                                  ▼
                   ┌──────────────────────────────────────────────────────┐
                   │                    OID4VP backend                     │
                   └──────────────────────────────────────────────────────┘
```

- **Part A (server)** lives inside the Resource Server. It is a thin, HTTP-only client of the
  OID4VP backend for **one** call (`POST /v1/verification/request`); everything else it does
  is local (build the challenge, verify the relayed HMAC). It never talks to the wallet, HSM,
  or Facilitator.
- **Part B (client)** lives inside the wallet/MCP. It calls the OID4VP backend to fetch the
  DCQL and submit the VP, delegating proof derivation and holder-binding signing to injected
  dependencies. It never verifies the HMAC.

## The jobs on each side

**Part A — server**

| Job | Entry point | What it does |
|---|---|---|
| **Challenge** | `X401Verifier.challenge()` → `Oid4vpClient.createVerificationRequest()` + `buildProofChallenge()` | Calls `POST /v1/verification/request` (Bearer, `callbackUrl: null` → sync-HMAC), then builds the `401` + `PROOF-REQUEST`. |
| **Verify** | `X401Verifier.verify()` → `parseProofResponse()` + `verifyProofResponse()` | Parses the `PROOF-RESPONSE` envelope, recomputes the HMAC, and fails closed on signature / freshness / session / status. |

**Part B — client**

| Job | Entry point | What it does |
|---|---|---|
| **Parse** | `X401Wallet.parseChallenge()` → `parseProofRequest()` | Decodes the `PROOF-REQUEST` into `verificationData`, `credentialRequirements`, `requestId`, `requestUri`, `nonce`. |
| **Fetch DCQL** | `X401Wallet.fetchDefinition()` → `Oid4vpWalletClient.getPresentation()` | `GET /v1/presentation/{id}` → `credentialQuery`, `nonce`, `responseUri`. |
| **Build VP** | `X401Wallet.buildVp()` → `buildVp()` | `vc.createVp(...)` (delegated) → holder-binding `signer.sign(nonce)` (delegated) → assemble, binding the verifier nonce in. |
| **Submit + package** | `X401Wallet.submit()` → `Oid4vpWalletClient.submitPresentation()` + `packageProofResponse()` | `POST /v1/presentation/submit`; wrap the signed result as a `PROOF-RESPONSE`. |

## Package dependency graph

```
x401-zetrix-integration ──depends on──▶ x401-zetrix-server   (Part A)
                        └──depends on──▶ x401-zetrix-client   (Part B)

x401-zetrix-server                      x401-zetrix-client
  ├─ config.ts   (X401Config)             ├─ config.ts        (X401WalletConfig)
  ├─ model.ts    (domain types)           ├─ model.ts         (domain types)
  ├─ errors.ts   (X401Error/Code)         ├─ signer.ts        (HolderSigner, VcProofProvider)
  ├─ client.ts   (Oid4vpClient)           ├─ oid4vp-client.ts (Oid4vpWalletClient)
  ├─ challenge.ts(buildProofChallenge)    ├─ vp-builder.ts    (buildVp)
  ├─ verify.ts   (parse/verify + HMAC)    ├─ proof-response.ts(parse/package)
  ├─ web/*.ts    (express/fastify/generic)├─ errors.ts        (X401WalletError/Code)
  └─ index.ts    (X401Verifier + exports) └─ index.ts         (X401Wallet + exports)
```

Both packages have **zero heavy runtime dependencies**. On the server, `express` and
`fastify` are optional peer deps used only by their adapters; structural typing keeps the SDK
compiling when neither is installed. The client is fully decoupled from Wallet BE / the ZID
VC MCP through the injected `HolderSigner` + `VcProofProvider` interfaces.

## Cross-language parity

The HMAC message construction, base64 encoding, header names, header envelope encoding, and
the error-code enums are **byte-identical** across all four Node/Java × server/client
implementations. §08 is the contract; its test vectors are committed to both repos. **Any RS
SDK must verify any wallet SDK's `PROOF-RESPONSE`.** Any change to the wire format lands in
both repos together.
