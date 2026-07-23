# API reference — Part B (client, `x401-zetrix-client`)

> Cross-references: §04 for the server API, §06 for configuration, §07 for a worked example,
> §08 for the wire contract.
> The signatures below are the frozen public surface, implemented and covered by tests.

The client answers a `PROOF-REQUEST` and produces a `PROOF-RESPONSE`. It performs
**orchestration, not heavy crypto** — VP derivation and holder-binding signing are delegated
to injected dependencies. It does NOT verify the HMAC (that is Part A's job).

## Facade — `X401Wallet`

```ts
class X401Wallet {
  constructor(
    cfg: X401WalletConfig,
    deps: { signer: HolderSigner; vc: VcProofProvider; submitAuth?: SubmitAuthProvider },
  );

  /** One-shot: PROOF-REQUEST → PROOF-RESPONSE. */
  respondToChallenge(proofRequest: string | ProofRequest, holderDid: string): Promise<ProofResponse>;

  // Granular steps
  parseChallenge(header: string): ProofRequest;
  fetchDefinition(requestId: string): Promise<PresentationDefinition>;
  buildVp(def: PresentationDefinition, holderDid: string): Promise<Vp>;
  submit(def: PresentationDefinition, vp: Vp): Promise<ProofResponse>;
}
```

## Injected dependencies

Implemented by the consumer (e.g. the agentic-wallet-mcp). See §06.

```ts
// Holder-binding signer — over Wallet BE → softHSM (stable across the HSM cutover)
interface HolderSigner {
  sign(nonce: string): Promise<{ signBlob: string; publicKey: string }>;
}

// VP derivation — over the ZID/VC MCP vp_create
interface VcProofProvider {
  createVp(input: { credentialQuery: unknown; nonce: string; holderDid: string })
    : Promise<{
        vp: unknown;
        ed25519PublicKey: string;
        bbsPublicKey: string;
        // DIF PE submission ({ id, definition_id, descriptor_map }); the backend requires it
        // (SubmitPresentationReqDto.presentation_submission @NotNull). vp_create owns it.
        presentationSubmission: Record<string, unknown>;
      }>;
}

// Submit wallet-auth — the verifier's WalletAuthenticationFilter requires the holder to
// authenticate POST /submit with X-Wallet-Public-Key + X-Wallet-Signed-Data (an Ed25519
// signature over the holder's own Zetrix address). Optional: omit for backends/tests that
// do not require it. Failure → SIGN_FAILED.
type SubmitAuthProvider = () => Promise<{ publicKey: string; signedData: string }>;
```

## OID4VP wallet client — `Oid4vpWalletClient`

```ts
class Oid4vpWalletClient {
  constructor(cfg: Required<X401WalletConfig>);

  // GET /v1/presentation/{id}
  getPresentation(requestId: string): Promise<PresentationDefinition>;

  // POST /v1/presentation/submit  (+ ed25519_public_key, bbs_public_key)
  // submitAuth (when supplied) adds X-Wallet-Public-Key + X-Wallet-Signed-Data headers.
  submitPresentation(
    def: PresentationDefinition,
    vp: Vp,
    keys: { ed25519PublicKey: string; bbsPublicKey: string },
    submitAuth?: SubmitAuthProvider,
  ): Promise<ProofResponse>;
}

interface PresentationDefinition {
  requestId: string;
  credentialQuery: unknown;
  nonce: string;        // verifier nonce the holder-binding signature must cover
  responseUri: string;
  expiresAt?: string;   // informational; the live backend may omit it (not required to build/submit)
}
```

- A non-2xx submit throws `SUBMIT_FAILED` **with the backend response body included** (e.g. a
  wallet-auth rejection surfaces `... [WALLET_AUTH_MISSING_PUBLIC_KEY]`).

- Uses global `fetch` (Node 18+). Transport failure → `X401WalletError(OID4VP_UNAVAILABLE)`;
  non-2xx on fetch → `DEFINITION_FETCH_FAILED`; non-2xx on submit → `SUBMIT_FAILED`.
- **Backend response shape (openid4vp-verifier-be):** every response is wrapped in
  `ResponseWrapper` (`{ object, … }`). `getPresentation` unwraps `.object` and maps the
  snake_case definition (`presentation_id`→`requestId`, `credential_query`→`credentialQuery`,
  `response_uri`→`responseUri`, `expires_at`→`expiresAt`). `submitPresentation` (sync-HMAC)
  takes the signed payload from `object.signed_result` and the HMAC/timestamp from the
  `X-Callback-Signature`/`X-Callback-Timestamp` headers.

## Parse challenge + build VP + package response

```ts
function parseProofRequest(header: string): ProofRequest;

interface ProofRequest {
  verificationData: { requestUri: string; nonce: string; expiresAt: string };
  credentialRequirements: Record<string, unknown>;
  requestId: string;
  requestUri: string;
  nonce: string;        // verifier nonce, bound into the derived proof
}

function buildVp(def: PresentationDefinition, holderDid: string, deps: {
  vc: VcProofProvider; signer: HolderSigner;
}): Promise<Vp>;        // vc.createVp(...) → holder-binding signer.sign(def.nonce) → assemble

function packageProofResponse(raw: {
  payloadJson: string; signature: string; timestamp: string;
}): ProofResponse;
```

- `parseProofRequest` malformed → `MALFORMED_PROOF_REQUEST`.
- `buildVp` VP derivation failure → `VP_BUILD_FAILED`; signing failure → `SIGN_FAILED`.
- `packageProofResponse` keeps `payloadJson` **verbatim** (never re-serialized) so the RS
  HMAC recomputes exactly — the construction is byte-identical to Part A (see §08.3).

## `Vp` and `ProofResponse`

```ts
interface Vp {
  vp: unknown;                 // opaque VP from the VcProofProvider
  ed25519PublicKey: string;
  bbsPublicKey: string;
  presentationSubmission: Record<string, unknown>;  // DIF PE submission → submit body
  holderBinding: { signBlob: string; publicKey: string };
}

interface ProofResponse {
  headerValue: string;   // base64url(UTF-8 JSON) — the PROOF-RESPONSE to replay to the RS
  payloadJson: string;   // verbatim signed payload
  signature: string;     // X-Callback-Signature (HMAC from OID4VP, sync mode)
  timestamp: string;     // X-Callback-Timestamp (ISO-8601 instant, verbatim — see §08.3)
  presentationId: string;
  verified: boolean;
  status: string;
}
```

## Errors

```ts
enum X401WalletErrorCode {
  OID4VP_UNAVAILABLE      = "OID4VP_UNAVAILABLE",
  MALFORMED_PROOF_REQUEST = "MALFORMED_PROOF_REQUEST",
  DEFINITION_FETCH_FAILED = "DEFINITION_FETCH_FAILED",
  VP_BUILD_FAILED         = "VP_BUILD_FAILED",
  SIGN_FAILED             = "SIGN_FAILED",
  SUBMIT_FAILED           = "SUBMIT_FAILED",
}

class X401WalletError extends Error {
  readonly code: X401WalletErrorCode;
  readonly cause?: unknown;
  constructor(code: X401WalletErrorCode, message?: string, cause?: unknown);
}
```

## Models

See [`packages/client/src/model.ts`](../packages/client/src/model.ts) for the full type
definitions: `VerificationData`, `CredentialRequirements`, `ProofRequest`,
`PresentationDefinition`, `Vp`, `VerifiedResult`, `ProofResponse`.
