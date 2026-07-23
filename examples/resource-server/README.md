# Example: x401 Resource Server (Express)

An Express server that gates an endpoint behind an **x401 identity proof** using
`x401-zetrix-server` (Part A).

The proof is a **one-shot handshake**: a client proves once at `POST /x401/session`, the
server verifies the `PROOF-RESPONSE` and issues a normal session token, and subsequent
requests to `GET /protected` authorize with that session — not by re-presenting the proof
(each `PROOF-RESPONSE` is single-use under the replay guard).

## Prerequisites

- Node.js ≥ 18, pnpm ≥ 8
- An OID4VP `apiKey` (`ztx_…`) and shared `callbackSecret` (via admin onboarding)
- A client/wallet that can answer a `PROOF-REQUEST` (see [`examples/client/`](../client/)
  or the agentic-wallet-mcp) to complete the handshake end-to-end

## Setup

```bash
pnpm install
pnpm build                 # build the SDK dist this example imports
cp .env.example .env       # then fill in the values
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default `3000`) |
| `X401_NETWORK` | one of these two | Zetrix network — `zetrix:testnet` (sandbox) or `zetrix:mainnet` (prod); derives the OID4VP base URL |
| `X401_OID4VP_BASE_URL` | one of these two | Explicit OID4VP base URL; overrides `X401_NETWORK` |
| `X401_API_KEY` | Yes | Bearer `ztx_…` key that authenticates request creation |
| `X401_CALLBACK_SECRET` | Yes | Shared HMAC secret used to verify the `PROOF-RESPONSE` |

Secrets come from the environment — never hard-code them.

## Run

```bash
pnpm dev                   # tsx (ESM)
# or from the repo root:
pnpm --filter @x401-zetrix/example-resource-server dev
```

## Endpoints

| Endpoint | Proof required | Description |
|---|---|---|
| `GET /health` | No | `{ status: "ok" }` |
| `POST /x401/session` | Yes — x401 proof | `401` + `PROOF-REQUEST` on first call; on the retry with a valid `PROOF-RESPONSE` → `200 { session }` |
| `GET /protected` | Session (Bearer) | `200 { ok: true }` when a valid session token is presented |

Opt-in hardening is enabled: an `InMemoryReplayGuard` (each `PROOF-RESPONSE` is single-use)
and an `onVerify` audit hook.

## Try it with curl

```bash
curl http://localhost:3000/health                  # 200
curl -i -X POST http://localhost:3000/x401/session # 401 + PROOF-REQUEST header
```

To complete the flow, a client answers the `PROOF-REQUEST` and the agent retries
`POST /x401/session` with the returned `PROOF-RESPONSE` header — then uses the `{ session }`
token as `Authorization: Bearer <session>` on `GET /protected`.
