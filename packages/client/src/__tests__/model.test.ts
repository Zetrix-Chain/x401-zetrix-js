import { describe, expect, it } from "vitest";
import type {
  CredentialRequirements,
  PresentationDefinition,
  ProofRequest,
  ProofResponse,
  VerificationData,
  VerifiedResult,
  Vp,
} from "../model.js";

/**
 * `model.ts` is pure type declarations — nothing to RED/GREEN as behaviour. These tests
 * lock each interface's shape to docs/08-wire-contract.md + docs/05-api-reference-client.md
 * so a silent drift from the wire contract fails here, not in cross-repo/Part-A integration.
 */
describe("client model shapes", () => {
  it("ProofRequest matches the parsed §2 PROOF-REQUEST", () => {
    const req: ProofRequest = {
      verificationData: {
        requestUri: "https://oid4vp.example/request/abc",
        nonce: "nonce-abc",
        expiresAt: "2026-02-23T10:35:00Z",
      },
      credentialRequirements: { credential_type: "age_verification" },
      requestId: "req_abc123",
      requestUri: "https://oid4vp.example/request/abc",
      nonce: "nonce-abc",
    };

    expect(Object.keys(req).sort()).toEqual(
      ["verificationData", "credentialRequirements", "requestId", "requestUri", "nonce"].sort(),
    );
    expect(Object.keys(req.verificationData).sort()).toEqual(
      ["requestUri", "nonce", "expiresAt"].sort(),
    );
  });

  it("PresentationDefinition carries the DCQL query + verifier nonce", () => {
    const def: PresentationDefinition = {
      requestId: "req_abc123",
      credentialQuery: { foo: "bar" },
      nonce: "verifier-nonce",
      responseUri: "https://oid4vp.example/presentation/submit",
      expiresAt: "2026-02-23T10:35:00Z",
    };

    expect(Object.keys(def).sort()).toEqual(
      ["requestId", "credentialQuery", "nonce", "responseUri", "expiresAt"].sort(),
    );
  });

  it("Vp carries the delegated proof, both public keys, and the holder binding", () => {
    const vp: Vp = {
      vp: { some: "vp" },
      ed25519PublicKey: "ed-pub",
      bbsPublicKey: "bbs-pub",
      holderBinding: { signBlob: "sig", publicKey: "hb-pub" },
    };

    expect(Object.keys(vp).sort()).toEqual(
      ["vp", "ed25519PublicKey", "bbsPublicKey", "holderBinding"].sort(),
    );
  });

  it("ProofResponse matches the §3 envelope + parsed fields, timestamp opaque string", () => {
    const resp: ProofResponse = {
      headerValue: "base64url-value",
      payloadJson: '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED"}',
      signature: "base64-signature",
      timestamp: "2026-02-23T10:30:00Z",
      presentationId: "req_abc123",
      verified: true,
      status: "VERIFIED",
    };

    expect(typeof resp.timestamp).toBe("string");
    expect(Object.keys(resp).sort()).toEqual(
      ["headerValue", "payloadJson", "signature", "timestamp", "presentationId", "verified", "status"].sort(),
    );
  });

  it("VerifiedResult matches the parsed payload fields", () => {
    const result: VerifiedResult = {
      presentationId: "req_abc123",
      verified: true,
      status: "VERIFIED",
      verifiedClaims: { age_over_18: true },
    };

    expect(result.presentationId).toBe("req_abc123");
    expect(result.verifiedClaims).toEqual({ age_over_18: true });
  });

  it("CredentialRequirements and VerificationData are usable as declared", () => {
    const reqs: CredentialRequirements = { credential_type: "age_verification", claims: ["age_over_18"] };
    const vd: VerificationData = {
      requestUri: "https://oid4vp.example/request/abc",
      nonce: "nonce-abc",
      expiresAt: "2026-02-23T10:35:00Z",
    };

    expect(reqs.credential_type).toBe("age_verification");
    expect(vd.nonce).toBe("nonce-abc");
  });
});
