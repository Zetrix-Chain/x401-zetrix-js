import { describe, expect, it, vi } from "vitest";
import { buildVp } from "../vp-builder.js";
import { X401WalletErrorCode } from "../errors.js";
import type { PresentationDefinition } from "../model.js";
import type { HolderSigner, VcProofProvider } from "../signer.js";

const DEF: PresentationDefinition = {
  requestId: "req_abc123",
  credentialQuery: { credential_type: "age_verification" },
  nonce: "verifier-nonce",
  responseUri: "https://oid4vp.example/api/v1/presentation/submit",
  expiresAt: "2026-02-23T10:35:00Z",
};

const HOLDER_DID = "did:zid:holder";

const SUBMISSION = {
  id: "sub_1",
  definition_id: "req_abc123",
  descriptor_map: [{ id: "age_verification", format: "ldp_vc", path: "$.verifiableCredential[0]" }],
};

function okVc(): VcProofProvider {
  return {
    createVp: vi.fn(async () => ({
      vp: { some: "vp" },
      ed25519PublicKey: "ed-pub",
      bbsPublicKey: "bbs-pub",
      presentationSubmission: SUBMISSION,
    })),
  };
}

function okSigner(): HolderSigner {
  return { sign: vi.fn(async () => ({ signBlob: "sig-blob", publicKey: "hb-pub" })) };
}

describe("buildVp", () => {
  it("delegates VP derivation and holder-binding signing, then assembles the Vp", async () => {
    const vc = okVc();
    const signer = okSigner();

    const vp = await buildVp(DEF, HOLDER_DID, { vc, signer });

    expect(vc.createVp).toHaveBeenCalledWith({
      credentialQuery: DEF.credentialQuery,
      nonce: DEF.nonce,
      holderDid: HOLDER_DID,
    });
    expect(signer.sign).toHaveBeenCalledWith(DEF.nonce); // binds the verifier nonce
    expect(vp).toEqual({
      vp: { some: "vp" },
      ed25519PublicKey: "ed-pub",
      bbsPublicKey: "bbs-pub",
      presentationSubmission: SUBMISSION,
      holderBinding: { signBlob: "sig-blob", publicKey: "hb-pub" },
    });
  });

  it("maps a VP derivation failure to VP_BUILD_FAILED", async () => {
    const vc: VcProofProvider = { createVp: vi.fn(async () => { throw new Error("vp_create down"); }) };

    await expect(buildVp(DEF, HOLDER_DID, { vc, signer: okSigner() })).rejects.toMatchObject({
      code: X401WalletErrorCode.VP_BUILD_FAILED,
    });
  });

  it("maps a holder-binding signing failure to SIGN_FAILED", async () => {
    const signer: HolderSigner = { sign: vi.fn(async () => { throw new Error("hsm down"); }) };

    await expect(buildVp(DEF, HOLDER_DID, { vc: okVc(), signer })).rejects.toMatchObject({
      code: X401WalletErrorCode.SIGN_FAILED,
    });
  });
});
