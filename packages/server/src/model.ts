/**
 * x401 domain models. See docs/04-api-reference-server.md and docs/08-wire-contract.md.
 */

/** Credential requirements echoed into the `PROOF-REQUEST` (DCQL / query shape). */
export interface CredentialRequirements {
  [key: string]: unknown;
}

/** Result of `POST /v1/verification/request` on the OID4VP backend. */
export interface VerificationData {
  /** presentationId — used as the session-binding `request_id` */
  requestId: string;
  requestUri: string;
  nonce: string;
  credentialQuery?: unknown;
  expiresAt: string;
}

/** Selectively-disclosed claims returned on a successful verification. */
export interface VerifiedClaims {
  [claim: string]: unknown;
}

/** The decoded `PROOF-REQUEST` JSON body (also returned as the 401 response body). */
export interface ProofRequestBody {
  verification_data: {
    requestUri: string;
    nonce: string;
    expiresAt: string;
  };
  credential_requirements: CredentialRequirements;
  request_id: string;
  nonce: string;
  request_uri: string;
}

/** Shape of an HTTP 401 challenge response. */
export interface Http401Like {
  status: 401;
  headers: Record<string, string>;
  body?: object;
}

/** The built challenge — carries the header value, the JSON body, and a 401 helper. */
export interface ProofRequest {
  /** base64url(UTF-8 JSON) value for the `PROOF-REQUEST` header */
  headerValue: string;
  body: ProofRequestBody;
  toHttp401(): Http401Like;
}

/** The parsed `PROOF-RESPONSE` envelope + extracted payload fields. */
export interface ProofResponse {
  /** the exact payload string the backend HMAC'd — extracted VERBATIM, never re-serialized */
  payloadJson: string;
  /** base64 HMAC-SHA256 over `timestamp + "." + payloadJson` */
  signature: string;
  /**
   * ISO-8601 instant string, generated upstream by the OID4VP verifier
   * (`DateTimeFormatter.ISO_INSTANT` — variable fraction precision, e.g. "2026-02-23T10:30:00Z").
   * Opaque — never regenerate/reformat; used verbatim in the HMAC message. See docs/08-wire-contract.md §3.
   */
  timestamp: string;
  presentationId: string;
  verified: boolean;
  status: string;
  verifiedClaims?: VerifiedClaims;
}

/** The outcome of verifying a `PROOF-RESPONSE`. */
export interface ProofVerdict {
  allowed: boolean;
  status: string;
  claims?: VerifiedClaims;
  errorCode?: string;
  errorMessage?: string;
}

/** Error payload rendered to the agent on reject (via `PROOF-RESULT`). */
export interface ProofResultError {
  code: string;
  message: string;
}
