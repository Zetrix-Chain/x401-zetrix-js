/**
 * `PROOF-REQUEST` parsing + `PROOF-RESPONSE` packaging (Part B).
 * See docs/08-wire-contract.md §2–3.
 *
 * The client does NOT verify the HMAC — it relays. `PROOF-RESPONSE` construction is
 * byte-identical to Part A (`${timestamp}.${payloadJson}`, base64url envelope).
 */

import { X401WalletError, X401WalletErrorCode } from "./errors.js";
import { isNonBlankString, isRecord } from "./guards.js";
import type { ProofRequest, ProofResponse } from "./model.js";

function malformedRequest(message: string, cause?: unknown): X401WalletError {
  return new X401WalletError(X401WalletErrorCode.MALFORMED_PROOF_REQUEST, message, cause);
}

/**
 * Decode + parse the `PROOF-REQUEST` header into a {@link ProofRequest}.
 * Malformed → X401WalletError(MALFORMED_PROOF_REQUEST).
 */
export function parseProofRequest(header: string): ProofRequest {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
  } catch (cause) {
    throw malformedRequest("PROOF-REQUEST is not valid base64url(UTF-8 JSON)", cause);
  }

  if (!isRecord(decoded)) {
    throw malformedRequest("PROOF-REQUEST: decoded value is not an object");
  }

  const vd = decoded.verification_data;
  if (
    !isRecord(vd) ||
    !isNonBlankString(vd.requestUri) ||
    !isNonBlankString(vd.nonce) ||
    !isNonBlankString(vd.expiresAt)
  ) {
    throw malformedRequest('PROOF-REQUEST: "verification_data" is missing or malformed');
  }
  if (!isRecord(decoded.credential_requirements)) {
    throw malformedRequest('PROOF-REQUEST: "credential_requirements" must be an object');
  }
  if (!isNonBlankString(decoded.request_id)) {
    throw malformedRequest('PROOF-REQUEST: "request_id" must be a non-blank string');
  }
  if (!isNonBlankString(decoded.request_uri)) {
    throw malformedRequest('PROOF-REQUEST: "request_uri" must be a non-blank string');
  }
  if (!isNonBlankString(decoded.nonce)) {
    throw malformedRequest('PROOF-REQUEST: "nonce" must be a non-blank string');
  }

  return {
    verificationData: {
      requestUri: vd.requestUri,
      nonce: vd.nonce,
      expiresAt: vd.expiresAt,
    },
    credentialRequirements: decoded.credential_requirements,
    requestId: decoded.request_id,
    requestUri: decoded.request_uri,
    nonce: decoded.nonce,
  };
}

/**
 * Package the OID4VP signed result into a {@link ProofResponse} envelope. The `payloadJson`
 * is kept VERBATIM (never re-serialized) so the RS HMAC recomputes exactly.
 */
export function packageProofResponse(raw: {
  payloadJson: string;
  signature: string;
  timestamp: string;
}): ProofResponse {
  let payload: unknown;
  try {
    payload = JSON.parse(raw.payloadJson);
  } catch (cause) {
    throw new X401WalletError(
      X401WalletErrorCode.SUBMIT_FAILED,
      "OID4VP signed result payload is not valid JSON",
      cause,
    );
  }

  if (
    !isRecord(payload) ||
    !isNonBlankString(payload.presentationId) ||
    typeof payload.verified !== "boolean" ||
    !isNonBlankString(payload.status)
  ) {
    throw new X401WalletError(
      X401WalletErrorCode.SUBMIT_FAILED,
      "OID4VP signed result payload is missing required fields",
    );
  }

  // Envelope built from the VERBATIM payload string — never re-serialized.
  const envelope = { payload: raw.payloadJson, signature: raw.signature, timestamp: raw.timestamp };
  const headerValue = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");

  return {
    headerValue,
    payloadJson: raw.payloadJson,
    signature: raw.signature,
    timestamp: raw.timestamp,
    presentationId: payload.presentationId,
    verified: payload.verified,
    status: payload.status,
  };
}
