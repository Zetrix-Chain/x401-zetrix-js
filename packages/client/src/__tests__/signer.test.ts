import { describe, expect, it } from "vitest";
import type { HolderSigner, VcProofProvider } from "../signer.js";

/**
 * `signer.ts` is injected-dependency interfaces only. These tests lock their call
 * shapes — the SDK delegates to consumer implementations, so the contract must not drift.
 */
describe("injected dependency contracts", () => {
  it("HolderSigner.sign takes the verifier nonce and returns { signBlob, publicKey }", async () => {
    const signer: HolderSigner = {
      async sign(nonce) {
        return { signBlob: `sig(${nonce})`, publicKey: "hb-pub" };
      },
    };

    await expect(signer.sign("verifier-nonce")).resolves.toEqual({
      signBlob: "sig(verifier-nonce)",
      publicKey: "hb-pub",
    });
  });

  it("VcProofProvider.createVp takes { credentialQuery, nonce, holderDid } and returns the VP + keys", async () => {
    const vc: VcProofProvider = {
      async createVp(input) {
        return { vp: { for: input.holderDid }, ed25519PublicKey: "ed", bbsPublicKey: "bbs" };
      },
    };

    await expect(
      vc.createVp({ credentialQuery: { q: 1 }, nonce: "n", holderDid: "did:zid:holder" }),
    ).resolves.toEqual({ vp: { for: "did:zid:holder" }, ed25519PublicKey: "ed", bbsPublicKey: "bbs" });
  });
});
