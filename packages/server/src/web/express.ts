/**
 * Express adapter — `requireProof()` middleware.
 *
 * `express` is an OPTIONAL peer dependency, so this adapter uses minimal structural
 * types instead of importing from `express` (keeps the SDK compiling without it).
 *
 * Behaviour:
 *   - no `PROOF-RESPONSE`  → 401 + `PROOF-REQUEST`
 *   - has `PROOF-RESPONSE` → verify → allow (claims on `req.x401Claims`) or 403 + error
 *
 * Session binding: by default the middleware self-binds to the `presentationId` inside
 * the `PROOF-RESPONSE` (HMAC, freshness and status are still enforced). For true
 * cross-request session binding, pass `resolveExpectedRequestId(req)` to return the
 * `request_id` the resource server originally issued for this session.
 */

import type { CredentialRequirements } from "../model.js";
import type { X401Verifier } from "../index.js";
import { handleChallenge, handleVerify, selfBoundRequestId } from "./generic.js";
import { renderProofResult } from "../result.js";

interface ExpressRequestLike {
  headers: Record<string, string | string[] | undefined>;
  [key: string]: unknown;
}

interface ExpressResponseLike {
  status(code: number): ExpressResponseLike;
  set(field: string, value: string): ExpressResponseLike;
  json(body: unknown): ExpressResponseLike;
}

type NextFunctionLike = (err?: unknown) => void;

export type RequestHandler = (
  req: ExpressRequestLike,
  res: ExpressResponseLike,
  next: NextFunctionLike,
) => void;

export interface RequireProofOptions {
  /**
   * Return the `request_id` the resource server issued for this session, for
   * cross-request session binding. If omitted, the middleware self-binds to the
   * `presentationId` carried in the `PROOF-RESPONSE`.
   */
  resolveExpectedRequestId?: (req: ExpressRequestLike) => string | undefined;
}

/**
 * Express middleware factory: gate a route behind an x401 identity proof.
 */
export function requireProof(
  verifier: X401Verifier,
  req: CredentialRequirements,
  opts?: RequireProofOptions,
): RequestHandler {
  return (httpReq, res, next) => {
    const header = verifier.readProofResponse(httpReq.headers);

    if (header === undefined) {
      handleChallenge(verifier, req)
        .then((http401) => {
          res.status(http401.status);
          for (const [name, value] of Object.entries(http401.headers)) {
            res.set(name, value);
          }
          res.json(http401.body);
        })
        .catch(next);
      return;
    }

    const expectedRequestId =
      opts?.resolveExpectedRequestId?.(httpReq) ?? selfBoundRequestId(header);
    const verdict = handleVerify(verifier, header, expectedRequestId);

    if (verdict.allowed) {
      httpReq.x401Claims = verdict.claims;
      next();
      return;
    }

    res.status(403).json(renderProofResult(verdict));
  };
}
