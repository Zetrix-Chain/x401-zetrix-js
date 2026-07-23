# x401-zetrix-js

Node.js/TypeScript SDKs for the **x401 identity-proof protocol** on the Zetrix blockchain —
**two packages, one per side of the flow**:

- **Part A — resource server** (`x401-zetrix-server`): lets any Node API require and verify
  an x401 proof — **challenge** (mint a verification request → `401 Proof-Required` +
  `PROOF-REQUEST`) and **verify** (parse the `PROOF-RESPONSE` → HMAC + freshness + session
  binding + status).
- **Part B — wallet/holder** (`x401-zetrix-client`): lets a wallet **answer** a
  `PROOF-REQUEST` — parse it, fetch the DCQL, build the VP (delegated), holder-binding sign
  (delegated), submit, and package the `PROOF-RESPONSE`.

Payment (x402) is a separate SDK. The server never talks to the wallet, HSM, or Facilitator.

## Packages

| Package | npm name | Role |
|---|---|---|
| [`packages/server`](packages/server) | `x401-zetrix-server` | Part A — RS verifier: config, models, OID4VP client, challenge builder, verify, web adapters (Express/Fastify/generic) |
| [`packages/client`](packages/client) | `x401-zetrix-client` | Part B — wallet/holder: config, models, injected signer/VC provider, OID4VP wallet client, VP builder, proof-response packaging |
| [`packages/integration`](packages/integration) | `x401-zetrix-integration` (private) | End-to-end tests against a mock OID4VP backend (both SDKs) |

## Documentation

See [`docs/`](docs/) for the full documentation set. Start with [`docs/README.md`](docs/README.md).

The **wire contract** ([`docs/08-wire-contract.md`](docs/08-wire-contract.md)) MUST stay
byte-identical with the Java repo (`x401-zetrix-java`) across all four Node/Java ×
server/client implementations.

## Requirements

- Node.js ≥ 18 (built-in `fetch`, `node:crypto`)
- pnpm ≥ 8

## Setup

```bash
pnpm install
pnpm build
```
