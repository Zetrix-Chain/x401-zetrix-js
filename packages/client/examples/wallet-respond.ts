/**
 * Sample x401 wallet (holder) — answer a PROOF-REQUEST and replay the PROOF-RESPONSE.
 *
 *   export X401_OID4VP_BASE_URL="https://zid-oid4vp-sandbox.zetrix.com/api"
 *   npx tsx examples/wallet-respond.ts
 *
 * The wallet performs orchestration only — VP derivation and holder-binding signing are
 * delegated to the injected `VcProofProvider` / `HolderSigner`. The SDK never touches a
 * raw key and never verifies the HMAC (that is the resource server's job).
 *
 * Inside this repo, replace "x401-zetrix-client" with "../src/index" to run against source.
 */

import {
  X401Wallet,
  type HolderSigner,
  type VcProofProvider,
} from "x401-zetrix-client";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Placeholder injected deps. In production these are backed by the Wallet BE -> softHSM
// (signer) and the ZID/VC MCP `vp_create` (vc). They must bind the verifier nonce.
const signer: HolderSigner = {
  async sign(nonce) {
    // Wallet BE / softHSM signs over the verifier nonce; returns the signature + pubkey.
    return { signBlob: `<sign(${nonce})>`, publicKey: "<holder-binding-public-key>" };
  },
};

const vc: VcProofProvider = {
  async createVp({ credentialQuery, nonce, holderDid }) {
    // ZID/VC MCP vp_create derives the VP (BBS+ selective disclosure), binding `nonce`.
    void credentialQuery;
    void holderDid;
    return {
      vp: { boundNonce: nonce /* ...derived VP... */ },
      ed25519PublicKey: "<ed25519-public-key>",
      bbsPublicKey: "<bbs-public-key>",
      // DIF PE submission — the backend requires presentation_submission on submit.
      presentationSubmission: {
        id: "<submission-id>",
        definition_id: "<presentation-definition-id>",
        descriptor_map: [{ id: "<query-id>", format: "ldp_vc", path: "$.verifiableCredential[0]" }],
      },
    };
  },
};

async function main(): Promise<void> {
  const wallet = new X401Wallet({ oid4vpBaseUrl: requireEnv("X401_OID4VP_BASE_URL") }, { signer, vc });

  // The agent received a 401 + PROOF-REQUEST header from the resource server:
  const proofRequestHeader = requireEnv("X401_PROOF_REQUEST"); // the RS's PROOF-REQUEST value
  const holderDid = process.env.X401_HOLDER_DID ?? "did:zid:holder";

  // One-shot: parse -> fetch definition -> build VP -> submit -> package.
  const proofResponse = await wallet.respondToChallenge(proofRequestHeader, holderDid);

  // Replay proofResponse.headerValue as the PROOF-RESPONSE header on the retry:
  console.info("PROOF-RESPONSE:", proofResponse.headerValue);
  console.info("status:", proofResponse.status, "presentationId:", proofResponse.presentationId);
}

main().catch((err) => {
  console.error("wallet failed:", err);
  process.exitCode = 1;
});
