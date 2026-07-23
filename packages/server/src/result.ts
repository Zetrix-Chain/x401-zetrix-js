/**
 * PROOF-RESULT rendering. See docs/04-api-reference-server.md §Web adapters.
 *
 * Maps a rejected {@link ProofVerdict} to the `{ code, message }` `ProofResultError`
 * body an RS returns to the agent on a 403. Centralises what the Express/Fastify
 * adapters would otherwise inline.
 */

import type { ProofResultError, ProofVerdict } from "./model.js";

/**
 * Render a rejected verdict as a `PROOF-RESULT` error body.
 *
 * @throws if called on an allowed verdict — there is nothing to render.
 */
export function renderProofResult(verdict: ProofVerdict): ProofResultError {
  if (verdict.allowed) {
    throw new Error("renderProofResult: verdict is allowed — no PROOF-RESULT to render");
  }
  return {
    code: verdict.errorCode ?? verdict.status,
    message: verdict.errorMessage ?? "credential presentation was not verified",
  };
}
