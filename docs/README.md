# x401-zetrix-js Documentation

Node.js/TypeScript SDKs for the **x401 identity-proof protocol** on Zetrix — **two packages,
one per side of the flow**:

- **Part A — `x401-zetrix-server`** (resource server): **challenge** (mint a verification
  request → `401` + `PROOF-REQUEST`) and **verify** (parse `PROOF-RESPONSE` → HMAC +
  freshness + session binding + status).
- **Part B — `x401-zetrix-client`** (wallet/holder): parse the `PROOF-REQUEST`, fetch the
  DCQL, build the VP (delegated), holder-binding sign (delegated), submit, and package the
  `PROOF-RESPONSE`.

> Payment (x402) is a separate SDK. The server never talks to the wallet, HSM, or Facilitator.

## Status

| Area | Status | See |
|---|---|---|
| `x401-zetrix-server` (Part A) | Implemented, unit-tested | §04 |
| `x401-zetrix-client` (Part B) | Implemented, unit-tested | §05 |
| `x401-zetrix-integration` (e2e) | Implemented, end-to-end tested | §03 |
| Wire contract | LOCKED — byte-identical across all four Node/Java × server/client | §08 |

## Document index

| # | File | Purpose | Audience |
|---|---|---|---|
| 00 | [00-overview.md](00-overview.md) | Repo scope, package inventory (server + client + integration), non-goals | All readers — start here |
| 01 | [01-architecture.md](01-architecture.md) | Both roles (RS verifier + wallet client), dependency graph | Architects, developers |
| 02 | [02-package-structure.md](02-package-structure.md) | pnpm workspace layout, TypeScript config, build commands | Developers |
| 03 | [03-flows.md](03-flows.md) | The full 401 Proof-Required sequence — RS challenge AND wallet respond legs | Developers, integrators |
| 04 | [04-api-reference-server.md](04-api-reference-server.md) | Part A API: X401Verifier, Oid4vpClient, challenge, verify, web adapters, errors | Developers |
| 05 | [05-api-reference-client.md](05-api-reference-client.md) | Part B API: X401Wallet, Oid4vpWalletClient, parse/build/package, injected signer/VC, errors | Developers |
| 06 | [06-configuration.md](06-configuration.md) | X401Config (server) + X401WalletConfig + injected HolderSigner/VcProofProvider (client) | Developers, DevOps |
| 07 | [07-quickstart.md](07-quickstart.md) | 5-minute guides: wire `requireProof()` on the server + use `X401Wallet` on the client | New developers |
| 08 | [08-wire-contract.md](08-wire-contract.md) | THE wire contract: headers, envelopes, HMAC, verify order, error codes, test vectors | Developers, Java-repo maintainers |

## Recommended reading order

**New developer:** 00 → 01 → 07 → 03

**Resource-server owner (Part A):** 00 → 04 → 06 → 07 → 08

**Wallet integrator (Part B):** 00 → 05 → 06 → 07 → 08

**Contributor / reviewer:** 00 → 01 → 02 → 03 → 04 → 05 → 08

**Java-repo maintainer (parity):** 08 only (the contract must match)
