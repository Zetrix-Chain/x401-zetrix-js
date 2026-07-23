import { describe, expect, it } from "vitest";
import { parseProofRequest, packageProofResponse } from "../proof-response.js";
import { X401WalletError, X401WalletErrorCode } from "../errors.js";

/** Build a §2 PROOF-REQUEST header value the way Part A's buildProofChallenge does. */
function encodeChallenge(body: unknown): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
}

const CHALLENGE_BODY = {
  verification_data: {
    requestUri: "https://oid4vp.example/request/abc",
    nonce: "verifier-nonce",
    expiresAt: "2026-02-23T10:35:00Z",
  },
  credential_requirements: { credential_type: "age_verification", claims: ["age_over_18"] },
  request_id: "req_abc123",
  nonce: "verifier-nonce",
  request_uri: "https://oid4vp.example/request/abc",
};

function expectMalformed(fn: () => unknown): void {
  expect(fn).toThrow(X401WalletError);
  try {
    fn();
    expect.unreachable("expected fn() to throw");
  } catch (err) {
    expect((err as X401WalletError).code).toBe(X401WalletErrorCode.MALFORMED_PROOF_REQUEST);
  }
}

describe("parseProofRequest", () => {
  it("decodes a §2 PROOF-REQUEST header into a ProofRequest", () => {
    const pr = parseProofRequest(encodeChallenge(CHALLENGE_BODY));

    expect(pr).toEqual({
      verificationData: {
        requestUri: "https://oid4vp.example/request/abc",
        nonce: "verifier-nonce",
        expiresAt: "2026-02-23T10:35:00Z",
      },
      credentialRequirements: { credential_type: "age_verification", claims: ["age_over_18"] },
      requestId: "req_abc123",
      requestUri: "https://oid4vp.example/request/abc",
      nonce: "verifier-nonce",
    });
  });

  it("throws MALFORMED_PROOF_REQUEST for a non-base64url / non-JSON header", () => {
    expectMalformed(() => parseProofRequest("!!!not-valid!!!"));
  });

  it("throws MALFORMED_PROOF_REQUEST when a required field is missing", () => {
    const { request_id, ...rest } = CHALLENGE_BODY;
    expectMalformed(() => parseProofRequest(encodeChallenge(rest)));
  });

  it("throws MALFORMED_PROOF_REQUEST when the decoded value is not an object", () => {
    expectMalformed(() => parseProofRequest(encodeChallenge("just-a-string")));
  });

  it("throws MALFORMED_PROOF_REQUEST when verification_data is malformed", () => {
    const body = { ...CHALLENGE_BODY, verification_data: { requestUri: "x", nonce: "y" } };
    expectMalformed(() => parseProofRequest(encodeChallenge(body)));
  });

  it("throws MALFORMED_PROOF_REQUEST when credential_requirements is not an object", () => {
    const body = { ...CHALLENGE_BODY, credential_requirements: "nope" };
    expectMalformed(() => parseProofRequest(encodeChallenge(body)));
  });

  it("throws MALFORMED_PROOF_REQUEST when request_uri is missing", () => {
    const { request_uri, ...rest } = CHALLENGE_BODY;
    expectMalformed(() => parseProofRequest(encodeChallenge(rest)));
  });

  it("throws MALFORMED_PROOF_REQUEST when nonce is missing", () => {
    const { nonce, ...rest } = CHALLENGE_BODY;
    expectMalformed(() => parseProofRequest(encodeChallenge(rest)));
  });
});

describe("packageProofResponse", () => {
  // Shared §5 wire vector — must round-trip identically with Part A.
  const payloadJson =
    '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":{"age_over_18":true}}';
  const signature = "MAFeEgvWAwBxMVINoNccuiBd7rbgJW2CzXMyvq3olyc=";
  const timestamp = "2026-02-23T10:30:00Z";

  it("builds a base64url envelope + surfaces the parsed payload fields", () => {
    const resp = packageProofResponse({ payloadJson, signature, timestamp });

    expect(resp.payloadJson).toBe(payloadJson);
    expect(resp.signature).toBe(signature);
    expect(resp.timestamp).toBe(timestamp);
    expect(resp.presentationId).toBe("req_abc123");
    expect(resp.verified).toBe(true);
    expect(resp.status).toBe("VERIFIED");
  });

  it("keeps payloadJson verbatim inside the envelope (byte-identical to Part A)", () => {
    const resp = packageProofResponse({ payloadJson, signature, timestamp });
    const envelope = JSON.parse(Buffer.from(resp.headerValue, "base64url").toString("utf8"));

    expect(envelope).toEqual({ payload: payloadJson, signature, timestamp });
    // the verbatim payload survives the round-trip unchanged
    expect(envelope.payload).toBe(payloadJson);
  });

  it("produces a URL-safe header value (no +, /, or = padding)", () => {
    const resp = packageProofResponse({ payloadJson, signature, timestamp });

    expect(resp.headerValue).not.toMatch(/[+/=]/);
  });

  it("throws SUBMIT_FAILED when payloadJson is not valid JSON", () => {
    expect(() => packageProofResponse({ payloadJson: "not-json", signature, timestamp })).toThrow(
      X401WalletError,
    );
    try {
      packageProofResponse({ payloadJson: "not-json", signature, timestamp });
    } catch (err) {
      expect((err as X401WalletError).code).toBe(X401WalletErrorCode.SUBMIT_FAILED);
    }
  });

  it("throws SUBMIT_FAILED when the payload is valid JSON but missing required fields", () => {
    try {
      packageProofResponse({ payloadJson: '{"verified":true}', signature, timestamp });
      expect.unreachable("expected packageProofResponse to throw");
    } catch (err) {
      expect((err as X401WalletError).code).toBe(X401WalletErrorCode.SUBMIT_FAILED);
    }
  });
});
