# Configuration

> Cross-references: §04/§05 for the APIs, §07 for a worked example.

# Part A — server (`x401-zetrix-server`)

## `X401Config`

| Field | Required | Default | Purpose |
|---|---|---|---|
| `network` | ⚠️ one of these two | — | Zetrix network whose default OID4VP URL is used (`zetrix:testnet` / `zetrix:mainnet`) |
| `oid4vpBaseUrl` | ⚠️ one of these two | derived from `network` | OID4VP backend base URL; **overrides `network`** when both are set |
| `apiKey` | ✅ | — | Bearer `ztx_...` — authenticates request creation |
| `callbackSecret` | ✅ | — | Shared HMAC secret — verifies `PROOF-RESPONSE` |
| `proofResponseTtlSec` | ❌ | `300` | Max age of the `PROOF-RESPONSE` timestamp (seconds) |
| `expirationMinutes` | ❌ | backend default | Verification-request TTL (minutes) |
| `proofRequestHeader` | ❌ | `PROOF-REQUEST` | Challenge header name |
| `proofResponseHeader` | ❌ | `PROOF-RESPONSE` | Result header name |

Provide **either** `network` **or** `oid4vpBaseUrl` (not necessarily both). `network` is the
convenient default; `oid4vpBaseUrl` is the explicit escape hatch and wins if both are given:

| `network` | resolved `oid4vpBaseUrl` |
|---|---|
| `zetrix:testnet` | `https://zid-oid4vp-sandbox.zetrix.com/api` |
| `zetrix:mainnet` | `https://zid-oid4vp.zetrix.com/api` |

```ts
type ZetrixNetwork = 'zetrix:testnet' | 'zetrix:mainnet';

interface X401Config {
  network?: ZetrixNetwork;    // sets oid4vpBaseUrl from the table above
  oid4vpBaseUrl?: string;     // explicit URL; overrides `network`
  apiKey: string;
  callbackSecret: string;
  proofResponseTtlSec?: number;
  expirationMinutes?: number;
  proofRequestHeader?: string;
  proofResponseHeader?: string;
}
```

The exported `ZETRIX_OID4VP_URLS` constant holds the network → URL map.

## `defineConfig()` validation

```ts
function defineConfig(cfg: X401Config): ResolvedX401Config;
```

`ResolvedX401Config` is `X401Config` with every default-bearing field filled in, but
`expirationMinutes` stays optional (`Required<X401Config>` would falsely promise a `number`
even when the caller omits it and the backend default applies).

`defineConfig()` (and `X401Verifier`'s constructor) **throws if `apiKey` or `callbackSecret`
is missing or blank, or if neither `network` nor a non-blank `oid4vpBaseUrl` is provided**
(an unknown `network` value also throws). `network` is resolved into `oid4vpBaseUrl` and does
not appear on the resolved config. Secrets come from env / a secret manager — **never
hard-code them**.

## Environment variables (convention)

The SDK does not read env vars directly; wire them in your app:

```bash
X401_NETWORK="zetrix:testnet"      # or "zetrix:mainnet" — derives the OID4VP base URL
# X401_OID4VP_BASE_URL="..."       # optional: pin the URL explicitly (overrides X401_NETWORK)
X401_API_KEY="ztx_..."            # Bearer API key (from admin, shown once)
X401_CALLBACK_SECRET="..."         # shared HMAC secret (from admin, shown once)
X401_PROOF_RESPONSE_TTL_SEC="300"  # optional
```

```ts
const verifier = new X401Verifier({
  network: process.env.X401_NETWORK as ZetrixNetwork,          // e.g. "zetrix:testnet"
  oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL,             // optional override (undefined is fine)
  apiKey: process.env.X401_API_KEY!,
  callbackSecret: process.env.X401_CALLBACK_SECRET!,
});
```

## Admin onboarding prerequisites

Before the SDK works, the resource server must be onboarded on the OID4VP backend
(documented here, **not** performed by the SDK):

1. **Admin registers the client** — `POST /v1/admin/clients`.
2. **Admin issues an API key** (`ztx_...`) — `POST /v1/admin/api-keys` *(shown once)*.
3. **Client obtains its callback secret** (shared HMAC secret) —
   `POST /v1/client/callback-secret` *(shown once)*.

Both the API key and the callback secret are **mandatory at SDK initialization**: the API
key authenticates request creation; the callback secret verifies the HMAC on the
`PROOF-RESPONSE`. Store both as secrets.

---

# Part B — client (`x401-zetrix-client`)

## `X401WalletConfig`

The client only needs the OID4VP base URL (no API key or callback secret — it does not
create verification requests or verify the HMAC). As on the server, provide **either**
`network` **or** `oid4vpBaseUrl`; the same `ZETRIX_OID4VP_URLS` map applies and an explicit
`oid4vpBaseUrl` overrides `network`.

| Field | Required | Default | Purpose |
|---|---|---|---|
| `network` | ⚠️ one of these two | — | `zetrix:testnet` / `zetrix:mainnet` — derives the OID4VP URL |
| `oid4vpBaseUrl` | ⚠️ one of these two | derived from `network` | OID4VP verifier base URL; **overrides `network`** |
| `proofRequestHeader` | ❌ | `PROOF-REQUEST` | Challenge header name (must match the RS) |
| `proofResponseHeader` | ❌ | `PROOF-RESPONSE` | Result header name (must match the RS) |
| `oid4vpTimeoutMs` | ❌ | `30000` | OID4VP backend request timeout in ms (`DEFAULT_OID4VP_TIMEOUT_MS`) |

```ts
interface X401WalletConfig {
  network?: ZetrixNetwork;    // sets oid4vpBaseUrl from ZETRIX_OID4VP_URLS
  oid4vpBaseUrl?: string;     // explicit URL; overrides `network`
  proofRequestHeader?: string;
  proofResponseHeader?: string;
  oid4vpTimeoutMs?: number;
}

function defineConfig(cfg: X401WalletConfig): ResolvedX401WalletConfig;
```

`defineConfig()` (and `X401Wallet`'s constructor) **throws if neither `network` nor a
non-blank `oid4vpBaseUrl` is provided (or `network` is unknown), or if `oid4vpTimeoutMs` is
not a finite positive number**, and fills the optional fields with their defaults.

> The wallet submits only to a `responseUri` that shares the configured `oid4vpBaseUrl`
> origin (off-origin submit targets are rejected with `SUBMIT_FAILED`). `X401WalletError`
> implements `toJSON()`, so `JSON.stringify` preserves its `message` for structured logs.

## Injected dependencies (`HolderSigner`, `VcProofProvider`)

The client is **decoupled** from Wallet BE and the ZID/VC MCP. The consumer (e.g. the
agentic-wallet-mcp) implements and injects two interfaces at construction — the SDK never
touches a raw key and never derives a proof in-process.

```ts
const wallet = new X401Wallet(
  { oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL! },
  {
    // over Wallet BE → softHSM (interface stable for the HSM cutover)
    signer: {
      async sign(nonce) { /* → { signBlob, publicKey } */ },
    },
    // over the ZID/VC MCP vp_create (BBS+ selective disclosure + Bulletproof range proof)
    vc: {
      async createVp({ credentialQuery, nonce, holderDid }) {
        /* → { vp, ed25519PublicKey, bbsPublicKey } */
      },
    },
  },
)
```

| Injected | Method | Purpose |
|---|---|---|
| `HolderSigner` | `sign(nonce)` → `{ signBlob, publicKey }` | Holder-binding signature over the verifier nonce (Wallet BE → softHSM). |
| `VcProofProvider` | `createVp({ credentialQuery, nonce, holderDid })` → `{ vp, ed25519PublicKey, bbsPublicKey }` | VP derivation (ZID/VC MCP `vp_create`). |

## Environment variables (convention)

```bash
X401_OID4VP_BASE_URL="https://zid-oid4vp-sandbox.zetrix.com/api"
```

The header names on the client must match the resource server's configured names (default
`PROOF-REQUEST` / `PROOF-RESPONSE`).
