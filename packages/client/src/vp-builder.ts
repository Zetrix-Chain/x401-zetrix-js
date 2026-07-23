/**
 * VP builder (Part B). See docs/05-api-reference-client.md.
 *
 * Delegates proof derivation to the injected `VcProofProvider` (ZID/VC MCP `vp_create`),
 * then holder-binding signs the verifier nonce via the injected `HolderSigner`, and
 * assembles the VP with the verifier nonce bound in. The SDK never touches a raw key.
 */

import { X401WalletError, X401WalletErrorCode } from "./errors.js";
import type { PresentationDefinition, Vp } from "./model.js";
import type { HolderSigner, VcProofProvider } from "./signer.js";

/**
 * Build the VP for a presentation definition: `vc.createVp(...)` → holder-binding
 * `signer.sign(def.nonce)` → assemble. VP derivation failure → VP_BUILD_FAILED;
 * signing failure → SIGN_FAILED.
 */
export async function buildVp(
  def: PresentationDefinition,
  holderDid: string,
  deps: { vc: VcProofProvider; signer: HolderSigner },
): Promise<Vp> {
  let derived: {
    vp: unknown;
    ed25519PublicKey: string;
    bbsPublicKey: string;
    presentationSubmission: Record<string, unknown>;
  };
  try {
    derived = await deps.vc.createVp({
      credentialQuery: def.credentialQuery,
      nonce: def.nonce,
      holderDid,
    });
  } catch (cause) {
    throw new X401WalletError(X401WalletErrorCode.VP_BUILD_FAILED, "VP derivation failed", cause);
  }

  let holderBinding: { signBlob: string; publicKey: string };
  try {
    holderBinding = await deps.signer.sign(def.nonce);
  } catch (cause) {
    throw new X401WalletError(X401WalletErrorCode.SIGN_FAILED, "holder-binding signing failed", cause);
  }

  return {
    vp: derived.vp,
    ed25519PublicKey: derived.ed25519PublicKey,
    bbsPublicKey: derived.bbsPublicKey,
    presentationSubmission: derived.presentationSubmission,
    holderBinding,
  };
}
