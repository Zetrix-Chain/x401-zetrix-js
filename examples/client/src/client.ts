/**
 * Example x401 client (wallet/holder) using `x401-zetrix-client`.
 *
 * Answers a PROOF-REQUEST and produces a PROOF-RESPONSE.
 *
 * ILLUSTRATIVE — NOT a full end-to-end demo. The client performs orchestration only; VP
 * derivation and holder-binding signing are DELEGATED to injected providers
 * (VcProofProvider / HolderSigner) that live outside this SDK (e.g. Wallet BE -> softHSM,
 * ZID/VC MCP `vp_create`). This example wires PLACEHOLDER providers, so it shows the API
 * and the flow but will not produce a cryptographically valid proof a resource server
 * accepts. Replace the placeholders with real providers for a working wallet.
 *
 * Copy .env.example to .env and fill in the values, then:  pnpm dev
 */

import "dotenv/config";
import {
  X401Wallet,
  type HolderSigner,
  type VcProofProvider,
  type ZetrixNetwork,
} from "x401-zetrix-client";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

// Placeholder injected deps. Replace with real implementations (Wallet BE / ZID-VC MCP).
const signer: HolderSigner = {
  async sign(nonce) {
    return { signBlob: `<holder-binding(${nonce})>`, publicKey: "<holder-binding-public-key>" };
  },
};

const vc: VcProofProvider = {
  async createVp({ nonce }) {
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
  const wallet = new X401Wallet(
    {
      // Pick a network (derives the OID4VP URL) or pin X401_OID4VP_BASE_URL explicitly.
      network: process.env.X401_NETWORK as ZetrixNetwork | undefined,
      oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL,
    },
    { signer, vc },
  );

  const proofRequestHeader = requireEnv("X401_PROOF_REQUEST");
  const holderDid = process.env.X401_HOLDER_DID ?? "did:zid:holder";

  // One-shot: parse -> fetch definition -> build VP (placeholder) -> submit -> package.
  const proofResponse = await wallet.respondToChallenge(proofRequestHeader, holderDid);

  console.info("PROOF-RESPONSE:", proofResponse.headerValue);
  console.info("status:", proofResponse.status, "presentationId:", proofResponse.presentationId);
}

main().catch((err) => {
  console.error("wallet failed:", err);
  process.exitCode = 1;
});
