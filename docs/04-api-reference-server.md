# API reference — Part A (server, `x401-zetrix-server`)

> Cross-references: §05 for the client API, §06 for configuration, §07 for a worked example,
> §08 for the wire contract.
> The signatures below are the frozen public surface, implemented and covered by tests.

## Facade — `X401Verifier`

```ts
class X401Verifier {
  constructor(cfg: X401Config);

  /** Create a verification request + build the 401 challenge in one call. */
  challenge(req: CredentialRequirements, stateId?: string): Promise<ProofRequest>;

  /** Detect a PROOF-RESPONSE on the incoming request headers. */
  hasProofResponse(headers: Record<string, string | string[] | undefined>): boolean;

  /** Verify a PROOF-RESPONSE header against the expected request id. */
  verify(proofResponseHeader: string, expectedRequestId: string): ProofVerdict;
}
```

## OID4VP client — `Oid4vpClient`

`POST /v1/verification/request` — Bearer API key; body
`{ requirements, callbackUrl: null, stateId?, expirationMinutes }`.

```ts
interface CreateVerificationRequestOpts {
  stateId?: string;
  clientMetadata?: Record<string, unknown>;
}

class Oid4vpClient {
  constructor(cfg: ResolvedX401Config);
  createVerificationRequest(
    req: CredentialRequirements,
    opts?: CreateVerificationRequestOpts,
  ): Promise<VerificationData>;
}
```

- Uses global `fetch` (Node 18+), adds the Bearer header.
- Non-2xx → `X401Error(REQUEST_CREATE_FAILED)`; transport failure → `X401Error(OID4VP_UNAVAILABLE)`.
- **Backend response shape (openid4vp-verifier-be):** the response is wrapped in
  `ResponseWrapper` (`{ object, … }`). The client unwraps `.object` and maps
  `CreateVerificationResponseDto` → `VerificationData` (`presentationId`→`requestId`;
  `requestUri` = `${oid4vpBaseUrl}/v1/presentation/${presentationId}`; `nonce`, `expiresAt`).

## Challenge builder

```ts
function buildProofChallenge(vd: VerificationData, req: CredentialRequirements): ProofRequest;

interface ProofRequest {
  headerValue: string;          // base64url(UTF-8 JSON) for the PROOF-REQUEST header
  body: ProofRequestBody;       // { verification_data, credential_requirements, request_id, nonce, request_uri }
  toHttp401(): Http401Like;     // { status: 401, headers, body? }
}
```

## Parse & verify

```ts
function parseProofResponse(header: string): ProofResponse;

function verifyProofResponse(
  pr: ProofResponse,
  expectedRequestId: string,
  cfg: ResolvedX401Config,
): ProofVerdict;

interface ProofVerdict {
  allowed: boolean;
  status: string;
  claims?: VerifiedClaims;
  errorCode?: string;
  errorMessage?: string;
}
```

Verification runs in the fail-closed order defined in §08.4: HMAC → freshness → session
binding → status.

## HMAC helpers

```ts
function hmacSign(message: string, secret: string): string;                        // base64 HMAC-SHA256
function hmacVerify(message: string, signatureB64: string, secret: string): boolean; // timing-safe
```

The message is `timestamp + "." + payload` (see §08.4). Comparison uses
`crypto.timingSafeEqual`.

## Web adapters

```ts
// Express (express = optional peer dep)
function requireProof(verifier: X401Verifier, req: CredentialRequirements): RequestHandler;

// Fastify (fastify = optional peer dep)
interface X401PluginOptions { verifier: X401Verifier; requirements: CredentialRequirements }
const x401Plugin: FastifyPluginAsyncLike<X401PluginOptions>;

// Framework-agnostic
function handleChallenge(v: X401Verifier, req: CredentialRequirements): Promise<Http401Like>;
function handleVerify(v: X401Verifier, header: string, expectedRequestId: string): ProofVerdict;
```

Adapter behaviour: no `PROOF-RESPONSE` → `401` + `PROOF-REQUEST`; present → verify → allow
(claims on `req.x401Claims`) or `403` + `PROOF-RESULT` error.

> The Express/Fastify adapters use minimal **structural** types instead of importing from
> `express`/`fastify`, so the SDK compiles even when neither peer dep is installed.

## Errors

```ts
enum X401ErrorCode {
  OID4VP_UNAVAILABLE       = "OID4VP_UNAVAILABLE",
  REQUEST_CREATE_FAILED    = "REQUEST_CREATE_FAILED",
  MALFORMED_PROOF_RESPONSE = "MALFORMED_PROOF_RESPONSE",
  BAD_SIGNATURE            = "BAD_SIGNATURE",
  STALE_TIMESTAMP          = "STALE_TIMESTAMP",
  SESSION_MISMATCH         = "SESSION_MISMATCH",
  PROOF_NOT_VERIFIED       = "PROOF_NOT_VERIFIED",
}

class X401Error extends Error {
  readonly code: X401ErrorCode;
  readonly cause?: unknown;
  constructor(code: X401ErrorCode, message?: string, cause?: unknown);
}

interface ProofResultError { code: string; message: string }  // rendered to the agent on reject
```

## Models

See [`packages/server/src/model.ts`](../packages/server/src/model.ts) for the full type
definitions: `CredentialRequirements`, `VerificationData`, `VerifiedClaims`,
`ProofRequest`, `ProofRequestBody`, `ProofResponse`, `ProofVerdict`, `ProofResultError`,
`Http401Like`.
