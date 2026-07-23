/** Wallet side of the e2e harness — a real X401Wallet with fake injected deps. */

import { X401Wallet, type HolderSigner, type VcProofProvider } from "x401-zetrix-client";

/** Deterministic stand-ins for Wallet BE / ZID-VC MCP (the SDK never touches a raw key). */
export function makeWallet(oid4vpBaseUrl: string): X401Wallet {
  const signer: HolderSigner = {
    async sign(nonce) {
      return { signBlob: `holder-binding(${nonce})`, publicKey: "hb-pub" };
    },
  };
  const vc: VcProofProvider = {
    async createVp(input) {
      // Bind the verifier nonce into the derived proof (as a real VP would).
      return {
        vp: { boundNonce: input.nonce, holderDid: input.holderDid, query: input.credentialQuery },
        ed25519PublicKey: "ed-pub",
        bbsPublicKey: "bbs-pub",
        // DIF PE submission — the backend requires it on submit (vp_create produces it).
        presentationSubmission: {
          id: "sub_e2e",
          definition_id: "def_e2e",
          descriptor_map: [{ id: "age_verification", format: "ldp_vc", path: "$.verifiableCredential[0]" }],
        },
      };
    },
  };
  return new X401Wallet({ oid4vpBaseUrl }, { signer, vc });
}
