/**
 * `PROOF-RESPONSE` parsing + verification. See docs/08-wire-contract.md §3–4.
 *
 * HMAC message construction and encoding are part of the LOCKED wire contract and
 * MUST stay byte-identical with the Java repo:
 *
 *   message   = timestamp + "." + payload   // timestamp = ISO-8601 instant string, used
 *                                            // verbatim (variable fraction precision —
 *                                            // do not regenerate/reformat), payload = the
 *                                            // verbatim payload string
 *   signature = base64( HMAC_SHA256(message, callbackSecret) )
 */

import { createHmac, timingSafeEqual } from "crypto";

import type { ResolvedX401Config } from "./config.js";
import { X401Error, X401ErrorCode } from "./errors.js";
import { isRecord } from "./guards.js";
import type { ProofResponse, ProofVerdict, VerifiedClaims } from "./model.js";

function malformed(message: string, cause?: unknown): X401Error {
  return new X401Error(X401ErrorCode.MALFORMED_PROOF_RESPONSE, message, cause);
}

function parseJson(json: string, what: string): unknown {
  try {
    return JSON.parse(json);
  } catch (cause) {
    throw malformed(`PROOF-RESPONSE: ${what} is not valid JSON`, cause);
  }
}

function requireTyped<T>(
  rec: Record<string, unknown>,
  field: string,
  isType: (value: unknown) => value is T,
  label: string,
): T {
  const value = rec[field];
  if (!isType(value)) {
    throw malformed(`PROOF-RESPONSE: "${field}" must be a ${label}`);
  }
  return value;
}

function requireString(rec: Record<string, unknown>, field: string): string {
  return requireTyped(rec, field, (v): v is string => typeof v === "string", "string");
}

function requireBoolean(rec: Record<string, unknown>, field: string): boolean {
  return requireTyped(rec, field, (v): v is boolean => typeof v === "boolean", "boolean");
}

function optionalRecord(rec: Record<string, unknown>, field: string): VerifiedClaims | undefined {
  const value = rec[field];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw malformed(`PROOF-RESPONSE: "${field}" must be an object`);
  }
  return value;
}

/** Decode + parse the `PROOF-RESPONSE` header. Malformed → X401Error(MALFORMED_PROOF_RESPONSE). */
export function parseProofResponse(header: string): ProofResponse {
  const decoded = Buffer.from(header, "base64url").toString("utf8");
  const envelope = parseJson(decoded, "envelope");
  if (!isRecord(envelope)) {
    throw malformed("PROOF-RESPONSE: envelope must be a JSON object");
  }

  const payloadJson = requireString(envelope, "payload");
  const signature = requireString(envelope, "signature");
  const timestamp = requireString(envelope, "timestamp");

  const payload = parseJson(payloadJson, "payload");
  if (!isRecord(payload)) {
    throw malformed("PROOF-RESPONSE: payload must be a JSON object");
  }

  return {
    payloadJson,
    signature,
    timestamp,
    presentationId: requireString(payload, "presentationId"),
    verified: requireBoolean(payload, "verified"),
    status: requireString(payload, "status"),
    verifiedClaims: optionalRecord(payload, "verifiedClaims"),
  };
}

function fail(errorCode: X401ErrorCode, errorMessage: string): ProofVerdict {
  return { allowed: false, status: errorCode, errorCode, errorMessage };
}

/** Build the rejected {@link ProofVerdict} shape for a caught {@link X401Error}. */
export function rejectedVerdict(err: X401Error): ProofVerdict {
  return fail(err.code, err.message);
}

/**
 * Verify a parsed `PROOF-RESPONSE`, failing closed in this order:
 *   1. HMAC (timing-safe)            → BAD_SIGNATURE
 *   2. freshness (proofResponseTtl)  → STALE_TIMESTAMP
 *   3. session binding               → SESSION_MISMATCH
 *   4. verified === true && status   → PROOF_NOT_VERIFIED
 */
export function verifyProofResponse(
  pr: ProofResponse,
  expectedRequestId: string,
  cfg: ResolvedX401Config,
): ProofVerdict {
  const message = `${pr.timestamp}.${pr.payloadJson}`;
  if (!hmacVerify(message, pr.signature, cfg.callbackSecret)) {
    return fail(X401ErrorCode.BAD_SIGNATURE, "PROOF-RESPONSE signature does not match");
  }

  const epochMs = new Date(pr.timestamp).getTime();
  const ttlMs = cfg.proofResponseTtlSec * 1000;
  // Symmetric window (wire-contract §4): reject stale AND implausibly-future timestamps.
  if (Number.isNaN(epochMs) || Math.abs(Date.now() - epochMs) > ttlMs) {
    return fail(
      X401ErrorCode.STALE_TIMESTAMP,
      "PROOF-RESPONSE timestamp is unparseable, stale, or too far in the future",
    );
  }

  if (pr.presentationId !== expectedRequestId) {
    return fail(X401ErrorCode.SESSION_MISMATCH, "PROOF-RESPONSE session does not match the expected request");
  }

  if (!pr.verified || pr.status !== "VERIFIED") {
    return fail(X401ErrorCode.PROOF_NOT_VERIFIED, "credential presentation was not verified");
  }

  return { allowed: true, status: pr.status, claims: pr.verifiedClaims };
}

/** base64 HMAC-SHA256 of `message` under `secret`. */
export function hmacSign(message: string, secret: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("base64");
}

/** Timing-safe comparison of a base64 HMAC-SHA256 signature. */
export function hmacVerify(message: string, signatureB64: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(message, "utf8").digest();
  const actual = Buffer.from(signatureB64, "base64");

  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
