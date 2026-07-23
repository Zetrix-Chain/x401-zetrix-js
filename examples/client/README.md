# Example: x401 Client (wallet/holder)

Answers a `PROOF-REQUEST` and produces a `PROOF-RESPONSE` using `x401-zetrix-client`
(Part B).

> **⚠️ Illustrative, not a full end-to-end demo.** The client performs *orchestration
> only* — VP derivation and holder-binding signing are **delegated to injected providers**
> (`VcProofProvider` / `HolderSigner`) that live outside this SDK (e.g. the Wallet BE →
> softHSM and the ZID/VC MCP `vp_create`). This example wires **placeholder** providers, so
> it shows the API and the flow but will **not** produce a cryptographically valid proof a
> resource server accepts. Replace the placeholders with real providers (see below) for a
> working wallet.

## Prerequisites

- Node.js ≥ 18, pnpm ≥ 8
- A `PROOF-REQUEST` header value (from a resource server's `401` response)

## Setup

```bash
pnpm install
pnpm build                 # build the SDK dist this example imports
cp .env.example .env       # then fill in the values
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `X401_NETWORK` | one of these two | Zetrix network — `zetrix:testnet` / `zetrix:mainnet`; derives the OID4VP base URL |
| `X401_OID4VP_BASE_URL` | one of these two | Explicit OID4VP base URL; overrides `X401_NETWORK` |
| `X401_HOLDER_DID` | No | Holder DID (default `did:zid:holder`) |
| `X401_PROOF_REQUEST` | Yes | The `PROOF-REQUEST` header value to answer |

## Run

```bash
pnpm dev                   # tsx (ESM)
# or from the repo root:
pnpm --filter @x401-zetrix/example-client dev
```

It runs the one-shot flow — `respondToChallenge(proofRequestHeader, holderDid)` — which
parses the challenge, fetches the presentation definition, builds the VP (placeholder),
submits it, and prints the packaged `PROOF-RESPONSE.headerValue` for the agent to replay to
the resource server.

## Wiring real providers

Replace the placeholder deps with your implementations:

```ts
const signer: HolderSigner = {
  async sign(nonce) { /* Wallet BE → softHSM → { signBlob, publicKey } */ },
}
const vc: VcProofProvider = {
  async createVp({ credentialQuery, nonce, holderDid }) {
    /* ZID/VC MCP vp_create → { vp, ed25519PublicKey, bbsPublicKey } */
  },
}
const wallet = new X401Wallet({ network: 'zetrix:testnet' }, { signer, vc })
```

The SDK never touches a raw key and never verifies the HMAC — it relays the backend's
signed result.
