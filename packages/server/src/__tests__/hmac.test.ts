import { describe, expect, it } from "vitest";
import { hmacSign, hmacVerify } from "../verify.js";

/**
 * Frozen shared test vector — docs/08-wire-contract.md §5. MUST stay byte-identical
 * with x401-zetrix-java. Do not regenerate; any change requires a coordinated
 * contract bump in both repos.
 */
const VECTOR = {
  callbackSecret: "test-callback-secret-0123456789",
  timestamp: "2026-02-23T10:30:00Z",
  payload:
    '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED","verifiedClaims":{"age_over_18":true}}',
  signature: "MAFeEgvWAwBxMVINoNccuiBd7rbgJW2CzXMyvq3olyc=",
};
const MESSAGE = `${VECTOR.timestamp}.${VECTOR.payload}`;

describe("hmacSign", () => {
  it("reproduces the frozen wire-contract vector (§5) exactly", () => {
    expect(hmacSign(MESSAGE, VECTOR.callbackSecret)).toBe(VECTOR.signature);
  });

  it("produces a different signature for a different message", () => {
    expect(hmacSign(MESSAGE + "x", VECTOR.callbackSecret)).not.toBe(VECTOR.signature);
  });

  it("produces a different signature for a different secret", () => {
    expect(hmacSign(MESSAGE, "a-different-secret-0123456789ab")).not.toBe(VECTOR.signature);
  });
});

describe("hmacVerify", () => {
  it("accepts the frozen vector's signature", () => {
    expect(hmacVerify(MESSAGE, VECTOR.signature, VECTOR.callbackSecret)).toBe(true);
  });

  it("rejects a tampered message", () => {
    expect(hmacVerify(MESSAGE + "x", VECTOR.signature, VECTOR.callbackSecret)).toBe(false);
  });

  it("rejects a tampered signature", () => {
    const tampered = VECTOR.signature.slice(0, -4) + "AAAA";
    expect(hmacVerify(MESSAGE, tampered, VECTOR.callbackSecret)).toBe(false);
  });

  it("rejects the right signature under the wrong secret", () => {
    expect(hmacVerify(MESSAGE, VECTOR.signature, "wrong-secret-0123456789abcdefgh")).toBe(false);
  });

  it("rejects a malformed (non-base64) signature without throwing", () => {
    expect(hmacVerify(MESSAGE, "not-valid-base64!!", VECTOR.callbackSecret)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    expect(hmacVerify(MESSAGE, "dG9vc2hvcnQ=", VECTOR.callbackSecret)).toBe(false);
  });
});
