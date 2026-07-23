import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { X401Verifier } from "../index.js";
import type { X401Config } from "../config.js";
import { handleChallenge, handleVerify } from "../web/generic.js";
import { hmacSign } from "../verify.js";
import { okResponse } from "./test-utils.js";

const SECRET = "test-callback-secret-0123456789";

const BASE_CFG: X401Config = {
  oid4vpBaseUrl: "https://oid4vp.example/api",
  apiKey: "ztx_test_key",
  callbackSecret: SECRET,
};

const VERIFICATION_DATA = {
  object: { presentationId: "req_abc123", nonce: "nonce-abc", expiresAt: "2026-02-23T10:35:00Z" },
  success: true,
};

function buildResponseHeader(
  overrides: { presentationId?: string; verified?: boolean; status?: string; secret?: string } = {},
): string {
  const presentationId = overrides.presentationId ?? "req_abc123";
  const verified = overrides.verified ?? true;
  const status = overrides.status ?? "VERIFIED";
  const timestamp = new Date().toISOString();

  const payloadJson = JSON.stringify({ presentationId, verified, status });
  const signature = hmacSign(`${timestamp}.${payloadJson}`, overrides.secret ?? SECRET);
  const envelope = { payload: payloadJson, signature, timestamp };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

describe("handleChallenge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the 401 challenge shape from the verifier", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const requirements = { credential_type: "age_verification", claims: ["age_over_18"] };

    const http401 = await handleChallenge(verifier, requirements);

    expect(http401.status).toBe(401);
    expect(http401.headers["PROOF-REQUEST"]).toBeTypeOf("string");
    expect(http401.body).toMatchObject({ request_id: "req_abc123" });
  });
});

describe("handleVerify", () => {
  it("delegates to the verifier and returns an allowed verdict", () => {
    const verifier = new X401Verifier(BASE_CFG);

    const verdict = handleVerify(verifier, buildResponseHeader(), "req_abc123");

    expect(verdict).toEqual({ allowed: true, status: "VERIFIED", claims: undefined });
  });

  it("returns a rejected verdict for a session mismatch", () => {
    const verifier = new X401Verifier(BASE_CFG);

    const verdict = handleVerify(verifier, buildResponseHeader(), "some-other-request-id");

    expect(verdict).toMatchObject({ allowed: false, errorCode: "SESSION_MISMATCH" });
  });
});
