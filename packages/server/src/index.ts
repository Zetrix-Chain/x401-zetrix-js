/**
 * x401-zetrix-server — public API (Part A, resource-server verifier).
 *
 * `X401Verifier` is the top-level facade; everything else is re-exported for
 * advanced/low-level use. See docs/04-api-reference-server.md.
 */

import { defineConfig } from "./config.js";
import type { ResolvedX401Config, X401Config } from "./config.js";
import { Oid4vpClient } from "./client.js";
import { buildProofChallenge } from "./challenge.js";
import { X401Error, X401ErrorCode } from "./errors.js";
import type { CredentialRequirements, ProofRequest, ProofVerdict } from "./model.js";
import type { ReplayGuard } from "./replay.js";
import { parseProofResponse, rejectedVerdict, verifyProofResponse } from "./verify.js";

/** Audit record emitted after each `verify()` call. Carries no secrets or claims. */
export interface VerifyAuditEvent {
  /** Whether the proof was accepted. */
  allowed: boolean;
  /** The `request_id` the proof was verified against. */
  requestId: string;
  /** The rejection error code, or `undefined` when allowed. */
  code?: string;
}

/** Optional collaborators for {@link X401Verifier} (dependencies, not config values). */
export interface X401VerifierOptions {
  /**
   * Opt-in replay guard. When supplied, a `request_id` that has already produced an
   * allowed verdict is rejected with `SESSION_MISMATCH`. Omit to disable replay
   * checking (no behaviour change). See {@link ReplayGuard} / `InMemoryReplayGuard`.
   */
  replayGuard?: ReplayGuard;
  /**
   * Opt-in audit hook, invoked once per `verify()` call that returns a verdict (i.e. not
   * when `verify()` rethrows an unexpected non-`X401Error`). Use it to record an audit
   * trail; the SDK itself logs nothing. A throwing hook never affects the verification
   * result. Never receives secrets or verified claims.
   */
  onVerify?: (event: VerifyAuditEvent) => void;
}

/**
 * Top-level facade: create the challenge and verify the retry.
 */
export class X401Verifier {
  private readonly cfg: ResolvedX401Config;
  private readonly client: Oid4vpClient;
  private readonly replayGuard?: ReplayGuard;
  private readonly onVerify?: (event: VerifyAuditEvent) => void;

  constructor(cfg: X401Config, opts?: X401VerifierOptions) {
    this.cfg = defineConfig(cfg);
    this.client = new Oid4vpClient(this.cfg);
    this.replayGuard = opts?.replayGuard;
    this.onVerify = opts?.onVerify;
  }

  /** Create a verification request + build the 401 challenge in one call. */
  async challenge(req: CredentialRequirements, stateId?: string): Promise<ProofRequest> {
    const vd = await this.client.createVerificationRequest(req, { stateId });
    return buildProofChallenge(vd, req, this.cfg.proofRequestHeader);
  }

  /** Detect a `PROOF-RESPONSE` on the incoming request headers (case-insensitive). */
  hasProofResponse(
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    return this.readProofResponse(headers) !== undefined;
  }

  /**
   * Read the `PROOF-RESPONSE` header value (case-insensitive) from an incoming
   * request's headers, or `undefined` if absent. If a framework supplies the header
   * as an array, the first value is returned.
   */
  readProofResponse(
    headers: Record<string, string | string[] | undefined>,
  ): string | undefined {
    const name = this.cfg.proofResponseHeader.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== name) {
        continue;
      }
      const first = Array.isArray(value) ? value[0] : value;
      // An empty (or array-of-empty) header means the caller has not presented a
      // proof yet — treat it as absent so the adapter issues a 401 challenge.
      if (first !== undefined && first !== "") {
        return first;
      }
    }
    return undefined;
  }

  /** Parse + verify a `PROOF-RESPONSE` header against the expected request id. Never throws. */
  verify(proofResponseHeader: string, expectedRequestId: string): ProofVerdict {
    let verdict: ProofVerdict;
    try {
      const pr = parseProofResponse(proofResponseHeader);
      verdict = verifyProofResponse(pr, expectedRequestId, this.cfg);
    } catch (err) {
      if (!(err instanceof X401Error)) {
        throw err;
      }
      verdict = rejectedVerdict(err);
    }

    // Replay guard: only consume the request_id once a proof is otherwise valid, so a
    // rejected attempt never burns a legitimate future proof for the same request_id.
    if (verdict.allowed && this.replayGuard && !this.replayGuard.checkAndRemember(expectedRequestId)) {
      verdict = rejectedVerdict(
        new X401Error(X401ErrorCode.SESSION_MISMATCH, "PROOF-RESPONSE request_id has already been used"),
      );
    }

    this.emitAudit(verdict, expectedRequestId);
    return verdict;
  }

  /** Emit the audit event, isolating a throwing hook from the verification result. */
  private emitAudit(verdict: ProofVerdict, requestId: string): void {
    if (!this.onVerify) {
      return;
    }
    try {
      this.onVerify({ allowed: verdict.allowed, requestId, code: verdict.errorCode });
    } catch {
      // An audit sink failure must never change the auth decision.
    }
  }
}

// ── Re-exports ────────────────────────────────────────────────────────────────
export {
  defineConfig,
  ZETRIX_OID4VP_URLS,
  DEFAULT_PROOF_REQUEST_HEADER,
  DEFAULT_PROOF_RESPONSE_HEADER,
  DEFAULT_PROOF_RESPONSE_TTL_SEC,
  DEFAULT_OID4VP_TIMEOUT_MS,
} from "./config.js";
export type { X401Config, ZetrixNetwork } from "./config.js";

export type {
  CredentialRequirements,
  VerificationData,
  VerifiedClaims,
  ProofRequest,
  ProofRequestBody,
  ProofResponse,
  ProofVerdict,
  ProofResultError,
  Http401Like,
} from "./model.js";

export { X401Error, X401ErrorCode } from "./errors.js";

export { Oid4vpClient } from "./client.js";
export type { CreateVerificationRequestOpts } from "./client.js";

export { buildProofChallenge } from "./challenge.js";

export {
  parseProofResponse,
  verifyProofResponse,
  hmacSign,
  hmacVerify,
} from "./verify.js";

// Web adapters. express/fastify are OPTIONAL peer deps — these use
// structural types so the SDK compiles without them installed.
export { requireProof } from "./web/express.js";
export type { RequestHandler, RequireProofOptions } from "./web/express.js";
export { x401Plugin } from "./web/fastify.js";
export type { X401PluginOptions, FastifyPluginAsyncLike } from "./web/fastify.js";
export { handleChallenge, handleVerify } from "./web/generic.js";

export { renderProofResult } from "./result.js";

export { InMemoryReplayGuard } from "./replay.js";
export type { ReplayGuard } from "./replay.js";
