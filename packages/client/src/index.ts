/**
 * x401-zetrix-client — public API (Part B, wallet/holder).
 *
 * `X401Wallet` is the top-level facade; everything else is re-exported for advanced /
 * low-level use. See docs/05-api-reference-client.md.
 */

import { defineConfig } from "./config.js";
import type { X401WalletConfig } from "./config.js";
import { X401WalletError, X401WalletErrorCode } from "./errors.js";
import type { PresentationDefinition, ProofRequest, ProofResponse, Vp } from "./model.js";
import { Oid4vpWalletClient } from "./oid4vp-client.js";
import { parseProofRequest } from "./proof-response.js";
import type { HolderSigner, SubmitAuthProvider, VcProofProvider } from "./signer.js";
import { buildVp } from "./vp-builder.js";

/**
 * Top-level facade: turn a `PROOF-REQUEST` into a `PROOF-RESPONSE`, either in one shot
 * or step by step. Delegates VP derivation + holder-binding signing to injected deps.
 */
export class X401Wallet {
  private readonly client: Oid4vpWalletClient;
  private readonly deps: { signer: HolderSigner; vc: VcProofProvider; submitAuth?: SubmitAuthProvider };

  constructor(
    cfg: X401WalletConfig,
    deps: { signer: HolderSigner; vc: VcProofProvider; submitAuth?: SubmitAuthProvider },
  ) {
    this.client = new Oid4vpWalletClient(defineConfig(cfg));
    this.deps = deps;
  }

  /** One-shot: `PROOF-REQUEST` → `PROOF-RESPONSE`. */
  async respondToChallenge(
    proofRequest: string | ProofRequest,
    holderDid: string,
  ): Promise<ProofResponse> {
    const req = typeof proofRequest === "string" ? this.parseChallenge(proofRequest) : proofRequest;
    const def = await this.fetchDefinition(req.requestId);
    // Anti-substitution: the fetched definition must carry the same verifier nonce the
    // challenge did, or we'd holder-bind the proof to the wrong nonce.
    if (def.nonce !== req.nonce) {
      throw new X401WalletError(
        X401WalletErrorCode.DEFINITION_FETCH_FAILED,
        "presentation definition nonce does not match the challenge nonce",
      );
    }
    const vp = await this.buildVp(def, holderDid);
    return this.submit(def, vp);
  }

  /** Parse a `PROOF-REQUEST` header into a {@link ProofRequest}. */
  parseChallenge(header: string): ProofRequest {
    return parseProofRequest(header);
  }

  /** Fetch the DCQL / presentation definition for a request id. */
  fetchDefinition(requestId: string): Promise<PresentationDefinition> {
    return this.client.getPresentation(requestId);
  }

  /** Build the VP (delegated derivation + holder-binding signing). */
  buildVp(def: PresentationDefinition, holderDid: string): Promise<Vp> {
    return buildVp(def, holderDid, this.deps);
  }

  /** Submit the VP and package the returned signed result as a `PROOF-RESPONSE`. */
  submit(def: PresentationDefinition, vp: Vp): Promise<ProofResponse> {
    return this.client.submitPresentation(
      def,
      vp,
      { ed25519PublicKey: vp.ed25519PublicKey, bbsPublicKey: vp.bbsPublicKey },
      this.deps.submitAuth,
    );
  }
}

// ── Re-exports ────────────────────────────────────────────────────────────────
export {
  defineConfig,
  ZETRIX_OID4VP_URLS,
  DEFAULT_PROOF_REQUEST_HEADER,
  DEFAULT_PROOF_RESPONSE_HEADER,
  DEFAULT_OID4VP_TIMEOUT_MS,
} from "./config.js";
export type { X401WalletConfig, ZetrixNetwork } from "./config.js";

export type {
  VerificationData,
  CredentialRequirements,
  ProofRequest,
  PresentationDefinition,
  Vp,
  VerifiedResult,
  ProofResponse,
} from "./model.js";

export type { HolderSigner, SubmitAuthProvider, VcProofProvider } from "./signer.js";

export { X401WalletError, X401WalletErrorCode } from "./errors.js";

export { Oid4vpWalletClient } from "./oid4vp-client.js";

export { buildVp } from "./vp-builder.js";

export { parseProofRequest, packageProofResponse } from "./proof-response.js";
