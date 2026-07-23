/**
 * x401 wallet/holder domain models (Part B — client).
 * See docs/05-api-reference-client.md and docs/08-wire-contract.md.
 */

/** The verification metadata echoed inside the `PROOF-REQUEST`. */
export interface VerificationData {
  requestUri: string;
  nonce: string;
  expiresAt: string;
}

/** Credential requirements echoed into the `PROOF-REQUEST` (DCQL / query shape). */
export interface CredentialRequirements {
  [key: string]: unknown;
}

/**
 * The parsed `PROOF-REQUEST` challenge (produced by Part A, consumed here).
 * See docs/08-wire-contract.md §2.
 */
export interface ProofRequest {
  verificationData: VerificationData;
  credentialRequirements: CredentialRequirements;
  /** presentationId — used to fetch the definition and bind the session */
  requestId: string;
  requestUri: string;
  /** verifier nonce — bound into the derived proof */
  nonce: string;
}

/**
 * The DCQL / presentation definition returned by `GET /v1/presentation/{id}`.
 */
export interface PresentationDefinition {
  requestId: string;
  credentialQuery: unknown;
  /** verifier nonce the holder-binding signature must cover */
  nonce: string;
  responseUri: string;
  /**
   * Informational expiry, if the backend supplies one. The live sandbox
   * `GET /v1/presentation/{id}` does NOT return an `expires_at` on the definition (only
   * `presentation_id`, `credential_query`, `nonce`, `response_uri`, `response_mode`,
   * `state`, `abort_uri`), so this is optional and never required to build/submit the VP.
   * Confirmed against the live verifier 2026-07-17.
   */
  expiresAt?: string;
}

/**
 * A built Verifiable Presentation ready to submit — the delegated VC proof plus the
 * holder-binding signature over the verifier nonce.
 */
export interface Vp {
  /** the VP object produced by the injected `VcProofProvider` (opaque to the SDK) */
  vp: unknown;
  /** Ed25519 public key accompanying the submission */
  ed25519PublicKey: string;
  /** BBS+ public key accompanying the submission */
  bbsPublicKey: string;
  /**
   * DIF Presentation-Exchange submission (`{ id, definition_id, descriptor_map }`), from the
   * `VcProofProvider`. Sent as the backend-required `presentation_submission` on submit.
   */
  presentationSubmission: Record<string, unknown>;
  /** holder-binding signature over the verifier nonce (from the injected `HolderSigner`) */
  holderBinding: { signBlob: string; publicKey: string };
}

/** The parsed contents of the signed `payload` JSON string. */
export interface VerifiedResult {
  presentationId: string;
  verified: boolean;
  status: string;
  verifiedClaims?: Record<string, unknown>;
}

/**
 * The packaged `PROOF-RESPONSE` — what the agent replays to the resource server.
 * See docs/08-wire-contract.md §3.
 */
export interface ProofResponse {
  /** base64url(UTF-8 JSON) value for the `PROOF-RESPONSE` header to replay to the RS */
  headerValue: string;
  /** the exact payload string the backend HMAC'd — kept VERBATIM, never re-serialized */
  payloadJson: string;
  /** X-Callback-Signature (HMAC from OID4VP, sync mode) */
  signature: string;
  /**
   * X-Callback-Timestamp — ISO-8601 instant string (variable fraction precision, e.g.
   * "2026-02-23T10:30:00Z"). Opaque — relay verbatim, never regenerate/reformat.
   */
  timestamp: string;
  presentationId: string;
  verified: boolean;
  status: string;
}
