import { describe, expect, it } from "vitest";
import type {
  CredentialRequirements,
  Http401Like,
  ProofRequest,
  ProofRequestBody,
  ProofResponse,
  ProofResultError,
  ProofVerdict,
  VerificationData,
  VerifiedClaims,
} from "../model.js";

/**
 * `model.ts` is pure type declarations — nothing to RED/GREEN as behavior.
 * These tests lock each interface's shape to docs/08-wire-contract.md so a
 * future edit that silently drifts from the wire contract fails at test time,
 * not in cross-repo integration with the Java SDK.
 */
describe("model shapes match docs/08-wire-contract.md", () => {
  it("ProofRequestBody matches §2 PROOF-REQUEST JSON shape", () => {
    const credentialRequirements: CredentialRequirements = { foo: "bar" };
    const body: ProofRequestBody = {
      verification_data: {
        requestUri: "https://oid4vp.example/request/abc",
        nonce: "nonce-abc",
        expiresAt: "2026-02-23T10:35:00Z",
      },
      credential_requirements: credentialRequirements,
      request_id: "req_abc123",
      nonce: "nonce-abc",
      request_uri: "https://oid4vp.example/request/abc",
    };

    expect(Object.keys(body).sort()).toEqual(
      [
        "verification_data",
        "credential_requirements",
        "request_id",
        "nonce",
        "request_uri",
      ].sort(),
    );
    expect(Object.keys(body.verification_data).sort()).toEqual(
      ["requestUri", "nonce", "expiresAt"].sort(),
    );
  });

  it("Http401Like models a 401 status with the PROOF-REQUEST header present", () => {
    const response: Http401Like = {
      status: 401,
      headers: { "PROOF-REQUEST": "base64url-value" },
      body: { request_id: "req_abc123" },
    };

    expect(response.status).toBe(401);
    expect(response.headers["PROOF-REQUEST"]).toBeDefined();
  });

  it("ProofRequest carries headerValue + body + a toHttp401 helper", () => {
    const proofRequest: ProofRequest = {
      headerValue: "base64url-value",
      body: {
        verification_data: {
          requestUri: "https://oid4vp.example/request/abc",
          nonce: "nonce-abc",
          expiresAt: "2026-02-23T10:35:00Z",
        },
        credential_requirements: {},
        request_id: "req_abc123",
        nonce: "nonce-abc",
        request_uri: "https://oid4vp.example/request/abc",
      },
      toHttp401(): Http401Like {
        return { status: 401, headers: {} };
      },
    };

    expect(proofRequest.toHttp401()).toEqual({ status: 401, headers: {} });
  });

  it("ProofResponse matches §3 envelope + parsed payload fields, timestamp as opaque string", () => {
    const verifiedClaims: VerifiedClaims = { age_over_18: true };
    const response: ProofResponse = {
      payloadJson:
        '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":{"age_over_18":true}}',
      signature: "base64-signature",
      timestamp: "2026-02-23T10:30:00Z",
      presentationId: "req_abc123",
      verified: true,
      status: "VERIFIED",
      verifiedClaims,
    };

    expect(typeof response.timestamp).toBe("string");
    expect(Object.keys(response).sort()).toEqual(
      [
        "payloadJson",
        "signature",
        "timestamp",
        "presentationId",
        "verified",
        "status",
        "verifiedClaims",
      ].sort(),
    );
  });

  it("ProofVerdict models both the allowed and rejected outcomes from §4", () => {
    const allowed: ProofVerdict = {
      allowed: true,
      status: "VERIFIED",
      claims: { age_over_18: true },
    };
    const rejected: ProofVerdict = {
      allowed: false,
      status: "STALE_TIMESTAMP",
      errorCode: "STALE_TIMESTAMP",
      errorMessage: "timestamp outside proofResponseTtl",
    };

    expect(allowed.allowed).toBe(true);
    expect(rejected.allowed).toBe(false);
    expect(rejected.errorCode).toBe("STALE_TIMESTAMP");
  });

  it("VerificationData carries the OID4VP backend's request-creation result", () => {
    const data: VerificationData = {
      requestId: "req_abc123",
      requestUri: "https://oid4vp.example/request/abc",
      nonce: "nonce-abc",
      expiresAt: "2026-02-23T10:35:00Z",
    };

    expect(data.requestId).toBe("req_abc123");
  });

  it("ProofResultError carries a code + message pair for PROOF-RESULT rendering", () => {
    const error: ProofResultError = { code: "BAD_SIGNATURE", message: "signature mismatch" };

    expect(Object.keys(error).sort()).toEqual(["code", "message"]);
  });
});
