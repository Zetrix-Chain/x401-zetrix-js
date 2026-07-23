# Wire contract (LOCKED)

> **This contract is canonical and MUST stay byte-identical across all four implementations**
> — Node/Java × server/client. The same section is committed to `x401-zetrix-js` and
> `x401-zetrix-java`, and both the server (Part A) and client (Part B) packages produce and
> consume it identically. The HMAC message construction, base64 encoding, header names,
> header envelope encoding, and the Part A error-code enum must produce identical bytes
> everywhere — **any RS SDK must verify any wallet SDK's `PROOF-RESPONSE`.** Any change lands
> in **both** repos together, with the shared test vectors (§5) updated in lockstep.

## 1. Headers

| Header | Direction | Default name |
|---|---|---|
| Proof challenge | RS → client (on 401) | `PROOF-REQUEST` |
| Proof result | client → RS (on retry) | `PROOF-RESPONSE` |

Header names are configurable but default to the above.

## 2. `PROOF-REQUEST` (challenge)

Header value = **base64url(UTF-8 JSON)** of:

```json
{
  "verification_data": { "requestUri": "...", "nonce": "...", "expiresAt": "..." },
  "credential_requirements": { /* echoed CredentialRequirements */ },
  "request_id": "<presentationId>",
  "nonce": "<verifier nonce>",
  "request_uri": "<OID4VP request_uri>"
}
```

The same JSON object is ALSO returned as the HTTP 401 response body (for clients that read
the body instead of the header). The `401` response status is `401` with reason phrase
`Proof Required`.

## 3. `PROOF-RESPONSE` (result relayed by the wallet/MCP)

Header value = **base64url(UTF-8 JSON)** of the envelope:

```json
{
  "payload": "<raw payloadJson string — VERBATIM, as HMAC'd by the backend>",
  "signature": "<base64 HMAC-SHA256>",
  "timestamp": "2026-02-23T10:30:00Z"
}
```

- `payload` is the exact string the OID4VP backend signed. Parsers MUST extract it
  byte-for-byte (do not re-serialize) so HMAC recomputation matches.
- `payload`, once parsed as JSON, contains: `presentationId`, `verified` (boolean),
  `status` (string), `verifiedClaims` (object, optional).
- `timestamp` is an **ISO-8601 instant string**, generated upstream by the OID4VP
  verifier via `ZonedDateTime.now().format(DateTimeFormatter.ISO_INSTANT)` — same
  format as the `X-Callback-Timestamp` header on its existing async callback path
  (see `zetrix-oid4vp`'s `docs/signed-verification-result-design.md` §4.1). This is
  **variable-precision, not fixed-millisecond**: `ISO_INSTANT` omits the fractional
  part entirely when sub-second nanos are zero, and otherwise prints 3, 6, or 9
  fraction digits — it does **not** behave like JS `Date.prototype.toISOString()`,
  which always pads to exactly 3 digits. Implementations MUST treat `timestamp` as
  an **opaque, verbatim string** — same rule as `payload` — and never regenerate,
  reformat, or re-parse-and-reprint it before using it in the HMAC message, or the
  signature will fail to match.

## 4. HMAC + verification algorithm

```
message   = timestamp + "." + payload            // payload = the verbatim string, not re-encoded
                                                   // timestamp = the ISO-8601 string, used verbatim
signature = base64( HMAC_SHA256(message, callbackSecret) )
```

`verifyProofResponse(pr, expectedRequestId, cfg)` performs, in order, **failing closed**:

1. **HMAC** — recompute over `timestamp + "." + payload` using the `timestamp` string
   verbatim (never reformatted); **timing-safe** compare to `signature`. Mismatch →
   `BAD_SIGNATURE`.
2. **Freshness** — parse `timestamp` as an ISO-8601 instant (e.g. `Instant.parse` /
   `new Date(timestamp)`) to compute an epoch for comparison only — the parsed value
   is never used to reconstruct the HMAC message. The window is **symmetric**:
   `|now - epoch| ≤ proofResponseTtl` (default 300 s), rejecting both stale timestamps
   and implausibly-future ones (clock-skew / replay guard). Unparseable, stale, or
   too-far-future → `STALE_TIMESTAMP`.
3. **Session binding** — `payload.presentationId === expectedRequestId`. Mismatch →
   `SESSION_MISMATCH`.
4. **Status** — `payload.verified === true && payload.status === "VERIFIED"`. Else →
   `PROOF_NOT_VERIFIED`.

All pass → `ProofVerdict { allowed: true, status, claims }`. Any failure → `allowed: false`
with `errorCode`/`errorMessage`.

> **Cross-repo alignment note (confirmed 2026-07-14):** the ISO-8601 timestamp,
> `X-Callback-Signature`/`X-Callback-Timestamp` headers, HMAC construction, and 4-field
> payload above are confirmed against the real verifier backend
> `genesis/zidv2/openid4vp-verifier-be` (`SyncVerificationResultPayload`,
> `PresentationController.submitPresentation`). The **HMAC is over `timestamp + "." +
> signed_result`**, where `signed_result` is the exact serialized
> `{presentationId, verified, status, verifiedClaims}` string — which matches the §5
> frozen vector. This LOCKED server↔client wire is unchanged.
>
> **OID4VP-backend boundary (NOT part of this locked wire):** the backend wraps every
> HTTP response in `ResponseWrapper<T>` (`{ object, messages, success }`); the
> presentation definition (`GET /v1/presentation/{id}`) is **snake_case**
> (`presentation_id`, `credential_query`, `response_uri`, `expires_at`); and the submit
> response carries the signed payload in the `object.signed_result` field. The SDK OID4VP
> clients (`Oid4vpClient`, `Oid4vpWalletClient`) unwrap `.object`, map these fields, and
> extract `signed_result`. This boundary is backend-facing and may still
> evolve; the locked PROOF-REQUEST/PROOF-RESPONSE + HMAC formats do not.

## 5. Shared test vectors

This canonical vector is shared with `x401-zetrix-java` so both SDKs verify identically:

```
callbackSecret : "test-callback-secret-0123456789"
timestamp      : "2026-02-23T10:30:00Z"
payload        : {"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":{"age_over_18":true}}
message        : 2026-02-23T10:30:00Z.{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":{"age_over_18":true}}
signature (b64): MAFeEgvWAwBxMVINoNccuiBd7rbgJW2CzXMyvq3olyc=
```

**FROZEN** — computed in ticket 04 (`hmacSign(message, callbackSecret)`,
`packages/server/src/__tests__/hmac.test.ts`) and asserted verbatim there. This value must
never change without a coordinated contract bump in both repos — `x401-zetrix-java` must
reproduce the same `signature (b64)` from the same `message`/`callbackSecret`.

## 6. Error codes (two enums)

Each side has its own enum. Both are part of the contract and must stay byte-identical with
their Java counterparts.

**Part A — server (`X401ErrorCode`):**

`OID4VP_UNAVAILABLE`, `REQUEST_CREATE_FAILED`, `MALFORMED_PROOF_RESPONSE`, `BAD_SIGNATURE`,
`STALE_TIMESTAMP`, `SESSION_MISMATCH`, `PROOF_NOT_VERIFIED`.

**Part B — client (`X401WalletErrorCode`):**

`OID4VP_UNAVAILABLE`, `MALFORMED_PROOF_REQUEST`, `DEFINITION_FETCH_FAILED`, `VP_BUILD_FAILED`,
`SIGN_FAILED`, `SUBMIT_FAILED`.
