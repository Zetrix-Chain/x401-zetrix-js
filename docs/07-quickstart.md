# Quickstart (5 minutes)

> Cross-references: §06 for configuration, §04/§05 for the APIs, §03 for the flow.
> This guide shows how to use both SDKs end to end.

---

# Part A — server (`x401-zetrix-server`)

## 1. Install

```bash
npm install x401-zetrix-server
npm install express          # optional peer dep — only if you use requireProof()
```

Prerequisites (see §06): an OID4VP `apiKey` (`ztx_...`) and a `callbackSecret`, both obtained
via admin onboarding and stored as secrets.

## 2. Configure

```ts
import { X401Verifier } from 'x401-zetrix-server'

const verifier = new X401Verifier({
  oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL!,   // https://zid-oid4vp-sandbox.zetrix.com/api
  apiKey:        process.env.X401_API_KEY!,           // ztx_...
  callbackSecret: process.env.X401_CALLBACK_SECRET!,  // shared HMAC secret
})
```

## 3. Wire `requireProof()` into an Express route

```ts
import express from 'express'
import { requireProof } from 'x401-zetrix-server'

const app = express()

const requirements = {
  // CredentialRequirements — the DCQL / query shape describing what to prove.
  // e.g. proof of age over 18. Echoed into the PROOF-REQUEST.
}

app.get('/protected', requireProof(verifier, requirements), (req, res) => {
  // Only reached when the proof verified.
  res.json({ ok: true, claims: (req as any).x401Claims })
})

app.listen(3000)
```

**First request (no proof)** → `401 Proof Required` with a `PROOF-REQUEST` header
(base64url-encoded JSON). After the wallet relays a proof, the agent **retries with
`PROOF-RESPONSE`**; the SDK verifies (HMAC → freshness → session binding → status) and either
serves the route (`200`, claims on `req.x401Claims`) or rejects (`403` + `PROOF-RESULT`).

### Framework-agnostic alternative

```ts
import { handleChallenge, handleVerify } from 'x401-zetrix-server'

const challenge = await handleChallenge(verifier, requirements) // → { status: 401, headers, body }
const verdict   = handleVerify(verifier, proofResponseHeader, expectedRequestId)
if (verdict.allowed) { /* serve */ } else { /* 403 with verdict.errorCode */ }
```

---

# Part B — client (`x401-zetrix-client`)

## 1. Install

```bash
npm install x401-zetrix-client
```

## 2. Provide the injected dependencies

The client delegates VP derivation and holder-binding signing (see §06):

```ts
import { X401Wallet } from 'x401-zetrix-client'

const wallet = new X401Wallet(
  { oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL! },
  {
    signer: { async sign(nonce) { /* Wallet BE → softHSM → { signBlob, publicKey } */ } },
    vc:     { async createVp(input) { /* ZID/VC MCP vp_create → { vp, ed25519PublicKey, bbsPublicKey } */ } },
  },
)
```

## 3. Answer a `PROOF-REQUEST`

```ts
// The agent received a 401 + PROOF-REQUEST from the resource server.
const proofResponse = await wallet.respondToChallenge(proofRequestHeader, holderDid)

// Replay proofResponse.headerValue as the PROOF-RESPONSE header on the retry:
await fetch('https://api.example.com/protected', {
  headers: { 'PROOF-RESPONSE': proofResponse.headerValue },
})
```

### Granular alternative

```ts
const req  = wallet.parseChallenge(proofRequestHeader)
const def  = await wallet.fetchDefinition(req.requestId)
const vp   = await wallet.buildVp(def, holderDid)
const resp = await wallet.submit(def, vp)   // → ProofResponse
```

The client never verifies the HMAC — it relays the backend's signed result. See §08 for the
exact wire format the headers must follow.
