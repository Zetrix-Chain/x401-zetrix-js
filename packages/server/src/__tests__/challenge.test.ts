import { describe, expect, it } from "vitest";
import { buildProofChallenge } from "../challenge.js";
import { DEFAULT_PROOF_REQUEST_HEADER } from "../config.js";
import type { CredentialRequirements, VerificationData } from "../model.js";

const VD: VerificationData = {
  requestId: "req_abc123",
  requestUri: "https://oid4vp.example.com/request/req_abc123",
  nonce: "verifier-nonce-xyz",
  expiresAt: "2026-02-23T10:35:00Z",
};

const REQ: CredentialRequirements = {
  credential_type: "age_verification",
  claims: ["age_over_18"],
};

describe("buildProofChallenge", () => {
  it("builds a body matching the wire-contract §2 shape", () => {
    const pr = buildProofChallenge(VD, REQ);

    expect(pr.body).toEqual({
      verification_data: {
        requestUri: VD.requestUri,
        nonce: VD.nonce,
        expiresAt: VD.expiresAt,
      },
      credential_requirements: REQ,
      request_id: VD.requestId,
      nonce: VD.nonce,
      request_uri: VD.requestUri,
    });
  });

  it("encodes headerValue as base64url(UTF-8 JSON) of the body", () => {
    const pr = buildProofChallenge(VD, REQ);
    const decoded = JSON.parse(Buffer.from(pr.headerValue, "base64url").toString("utf8"));

    expect(decoded).toEqual(pr.body);
  });

  it("produces a URL-safe header value (no +, /, or = padding)", () => {
    const pr = buildProofChallenge(VD, REQ);

    expect(pr.headerValue).not.toMatch(/[+/=]/);
  });

  it("echoes credential_requirements verbatim", () => {
    const pr = buildProofChallenge(VD, REQ);

    expect(pr.body.credential_requirements).toEqual(REQ);
  });

  it("toHttp401() returns a 401 with the PROOF-REQUEST header and the body echoed", () => {
    const pr = buildProofChallenge(VD, REQ);
    const http401 = pr.toHttp401();

    expect(http401.status).toBe(401);
    expect(http401.headers[DEFAULT_PROOF_REQUEST_HEADER]).toBe(pr.headerValue);
    expect(http401.body).toEqual(pr.body);
  });

  it("toHttp401() honors a custom proofRequestHeader name instead of the default", () => {
    const pr = buildProofChallenge(VD, REQ, "X-Custom-Request");
    const http401 = pr.toHttp401();

    expect(http401.headers["X-Custom-Request"]).toBe(pr.headerValue);
    expect(http401.headers[DEFAULT_PROOF_REQUEST_HEADER]).toBeUndefined();
  });
});
