import { describe, expect, it } from "vitest";
import type { ResolvedX401Config } from "../config.js";
import { X401Error, X401ErrorCode } from "../errors.js";
import type { ProofResponse, VerifiedClaims } from "../model.js";
import { hmacSign, parseProofResponse, verifyProofResponse } from "../verify.js";

const SECRET = "test-callback-secret-0123456789";

const CFG: ResolvedX401Config = {
  oid4vpBaseUrl: "https://oid4vp.example.com",
  apiKey: "ztx_test_key",
  callbackSecret: SECRET,
  proofResponseTtlSec: 300,
  expirationMinutes: undefined,
  proofRequestHeader: "PROOF-REQUEST",
  proofResponseHeader: "PROOF-RESPONSE",
};

function toHeader(envelope: unknown): string {
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

function buildProofResponse(overrides: {
  presentationId?: string;
  verified?: boolean;
  status?: string;
  verifiedClaims?: VerifiedClaims;
  timestamp?: string;
  secret?: string;
} = {}): ProofResponse {
  const presentationId = overrides.presentationId ?? "req_abc123";
  const verified = overrides.verified ?? true;
  const status = overrides.status ?? "VERIFIED";
  const timestamp = overrides.timestamp ?? new Date().toISOString();

  const payloadObj: Record<string, unknown> = { presentationId, verified, status };
  if (overrides.verifiedClaims !== undefined) {
    payloadObj.verifiedClaims = overrides.verifiedClaims;
  }
  const payloadJson = JSON.stringify(payloadObj);
  const signature = hmacSign(`${timestamp}.${payloadJson}`, overrides.secret ?? SECRET);

  return {
    payloadJson,
    signature,
    timestamp,
    presentationId,
    verified,
    status,
    verifiedClaims: overrides.verifiedClaims,
  };
}

function expectMalformed(fn: () => unknown): void {
  expect(fn).toThrow(X401Error);
  try {
    fn();
    expect.unreachable("expected fn() to throw");
  } catch (err) {
    expect((err as X401Error).code).toBe(X401ErrorCode.MALFORMED_PROOF_RESPONSE);
  }
}

describe("parseProofResponse", () => {
  it("decodes a well-formed envelope, preserving payloadJson byte-for-byte", () => {
    const payloadJson =
      '{"status":"VERIFIED","presentationId":"req_abc123","verified":true,"verifiedClaims":{"age_over_18":true}}';
    const header = toHeader({ payload: payloadJson, signature: "sig123", timestamp: "2026-02-23T10:30:00Z" });

    const pr = parseProofResponse(header);

    expect(pr.payloadJson).toBe(payloadJson);
    expect(pr.signature).toBe("sig123");
    expect(pr.timestamp).toBe("2026-02-23T10:30:00Z");
    expect(pr.presentationId).toBe("req_abc123");
    expect(pr.verified).toBe(true);
    expect(pr.status).toBe("VERIFIED");
    expect(pr.verifiedClaims).toEqual({ age_over_18: true });
  });

  it("leaves verifiedClaims undefined when absent", () => {
    const payloadJson = '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED"}';
    const header = toHeader({ payload: payloadJson, signature: "sig123", timestamp: "2026-02-23T10:30:00Z" });

    expect(parseProofResponse(header).verifiedClaims).toBeUndefined();
  });

  it("throws MALFORMED_PROOF_RESPONSE for a non-JSON envelope", () => {
    const header = Buffer.from("not-json", "utf8").toString("base64url");
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when the envelope is missing a required field", () => {
    const header = toHeader({ payload: "{}", signature: "sig123" });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when payload is not valid JSON", () => {
    const header = toHeader({ payload: "not-json", signature: "sig123", timestamp: "2026-02-23T10:30:00Z" });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when payload is missing a required field", () => {
    const header = toHeader({
      payload: '{"verified":true,"status":"VERIFIED"}',
      signature: "sig123",
      timestamp: "2026-02-23T10:30:00Z",
    });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when the envelope is valid JSON but not an object", () => {
    const header = Buffer.from(JSON.stringify("just-a-string"), "utf8").toString("base64url");
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when payload is valid JSON but not an object", () => {
    const header = toHeader({ payload: "42", signature: "sig123", timestamp: "2026-02-23T10:30:00Z" });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when verified is present but not a boolean", () => {
    const header = toHeader({
      payload: '{"presentationId":"req_abc123","verified":"yes","status":"VERIFIED"}',
      signature: "sig123",
      timestamp: "2026-02-23T10:30:00Z",
    });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when verifiedClaims is present but not an object", () => {
    const header = toHeader({
      payload: '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":"nope"}',
      signature: "sig123",
      timestamp: "2026-02-23T10:30:00Z",
    });
    expectMalformed(() => parseProofResponse(header));
  });

  it("throws MALFORMED_PROOF_RESPONSE when verifiedClaims is an array", () => {
    const header = toHeader({
      payload: '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":[1,2,3]}',
      signature: "sig123",
      timestamp: "2026-02-23T10:30:00Z",
    });
    expectMalformed(() => parseProofResponse(header));
  });
});

describe("verifyProofResponse", () => {
  it("allows a fresh, correctly-signed, verified response", () => {
    const verdict = verifyProofResponse(buildProofResponse(), "req_abc123", CFG);

    expect(verdict).toEqual({ allowed: true, status: "VERIFIED", claims: undefined });
  });

  it("returns verifiedClaims on success when present", () => {
    const claims = { age_over_18: true };
    const verdict = verifyProofResponse(buildProofResponse({ verifiedClaims: claims }), "req_abc123", CFG);

    expect(verdict.allowed).toBe(true);
    expect(verdict.claims).toEqual(claims);
  });

  it("rejects a tampered signature with BAD_SIGNATURE", () => {
    const pr = buildProofResponse();
    const tampered = { ...pr, signature: pr.signature.slice(0, -4) + "AAAA" };

    const verdict = verifyProofResponse(tampered, "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, status: "BAD_SIGNATURE", errorCode: "BAD_SIGNATURE" });
  });

  it("rejects a response signed under the wrong secret with BAD_SIGNATURE", () => {
    const pr = buildProofResponse({ secret: "a-different-secret-0123456789ab" });

    const verdict = verifyProofResponse(pr, "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "BAD_SIGNATURE" });
  });

  it("rejects a stale timestamp with STALE_TIMESTAMP", () => {
    const staleTimestamp = new Date(Date.now() - 301_000).toISOString();
    const pr = buildProofResponse({ timestamp: staleTimestamp });

    const verdict = verifyProofResponse(pr, "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "STALE_TIMESTAMP" });
  });

  it("rejects an unparseable timestamp with STALE_TIMESTAMP", () => {
    const pr = buildProofResponse({ timestamp: "not-a-timestamp" });

    const verdict = verifyProofResponse(pr, "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "STALE_TIMESTAMP" });
  });

  it("rejects an implausibly-future timestamp with STALE_TIMESTAMP (symmetric window)", () => {
    const futureTimestamp = new Date(Date.now() + 301_000).toISOString();
    const pr = buildProofResponse({ timestamp: futureTimestamp });

    const verdict = verifyProofResponse(pr, "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "STALE_TIMESTAMP" });
  });

  it("allows a timestamp within the future half of the symmetric window", () => {
    const nearFuture = new Date(Date.now() + 60_000).toISOString();
    const pr = buildProofResponse({ timestamp: nearFuture });

    const verdict = verifyProofResponse(pr, "req_abc123", CFG);

    expect(verdict.allowed).toBe(true);
  });

  it("checks HMAC before freshness — bad signature wins over stale timestamp", () => {
    const staleTimestamp = new Date(Date.now() - 301_000).toISOString();
    const pr = buildProofResponse({ timestamp: staleTimestamp });
    const tampered = { ...pr, signature: pr.signature.slice(0, -4) + "AAAA" };

    const verdict = verifyProofResponse(tampered, "req_abc123", CFG);

    expect(verdict.errorCode).toBe("BAD_SIGNATURE");
  });

  it("checks freshness before session binding — stale timestamp wins over session mismatch", () => {
    const staleTimestamp = new Date(Date.now() - 301_000).toISOString();
    const pr = buildProofResponse({ timestamp: staleTimestamp });

    const verdict = verifyProofResponse(pr, "some-other-request-id", CFG);

    expect(verdict.errorCode).toBe("STALE_TIMESTAMP");
  });

  it("rejects a session mismatch with SESSION_MISMATCH", () => {
    const verdict = verifyProofResponse(buildProofResponse(), "some-other-request-id", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "SESSION_MISMATCH" });
  });

  it("checks session binding before status — session mismatch wins over unverified status", () => {
    const pr = buildProofResponse({ verified: false });

    const verdict = verifyProofResponse(pr, "some-other-request-id", CFG);

    expect(verdict.errorCode).toBe("SESSION_MISMATCH");
  });

  it("rejects verified=false with PROOF_NOT_VERIFIED", () => {
    const verdict = verifyProofResponse(buildProofResponse({ verified: false }), "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "PROOF_NOT_VERIFIED" });
  });

  it("rejects status !== VERIFIED with PROOF_NOT_VERIFIED", () => {
    const verdict = verifyProofResponse(buildProofResponse({ status: "PENDING" }), "req_abc123", CFG);

    expect(verdict).toMatchObject({ allowed: false, errorCode: "PROOF_NOT_VERIFIED" });
  });
});
