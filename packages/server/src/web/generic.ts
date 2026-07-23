/**
 * Framework-agnostic web helpers. See docs/04-api-reference-server.md §Web adapters.
 */

import type { CredentialRequirements, Http401Like, ProofVerdict } from "../model.js";
import type { X401Verifier } from "../index.js";
import { parseProofResponse } from "../verify.js";

/** Create the verification request and build the 401 challenge. */
export async function handleChallenge(
  v: X401Verifier,
  req: CredentialRequirements,
): Promise<Http401Like> {
  const challenge = await v.challenge(req);
  return challenge.toHttp401();
}

/** Parse + verify a `PROOF-RESPONSE` header against the expected request id. */
export function handleVerify(
  v: X401Verifier,
  header: string,
  expectedRequestId: string,
): ProofVerdict {
  return v.verify(header, expectedRequestId);
}

/**
 * Self-bind: the expected request id is the `PROOF-RESPONSE`'s own `presentationId`.
 * A malformed header yields `""`, which `verify()` then rejects with
 * `MALFORMED_PROOF_RESPONSE`. Shared by the Express and Fastify adapters as the default
 * when no `resolveExpectedRequestId` is supplied.
 */
export function selfBoundRequestId(header: string): string {
  try {
    return parseProofResponse(header).presentationId;
  } catch {
    return "";
  }
}
