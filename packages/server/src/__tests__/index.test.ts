import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROOF_RESPONSE_HEADER, X401Verifier } from "../index.js";
import { InMemoryReplayGuard } from "../replay.js";
import type { X401Config } from "../config.js";
import { hmacSign } from "../verify.js";
import { okResponse } from "./test-utils.js";

const SECRET = "test-callback-secret-0123456789";

const BASE_CFG: X401Config = {
  oid4vpBaseUrl: "https://oid4vp.example/api",
  apiKey: "ztx_test_key",
  callbackSecret: SECRET,
};

// Real backend response (ResponseWrapper<CreateVerificationResponseDto>).
const VERIFICATION_DATA = {
  object: { presentationId: "req_abc123", nonce: "nonce-abc", expiresAt: "2026-02-24T10:45:00" },
  success: true,
};

// What the SDK maps that to (requestUri = base + /v1/presentation/{presentationId}).
const EXPECTED_VD = {
  requestId: "req_abc123",
  requestUri: "https://oid4vp.example/api/v1/presentation/req_abc123",
  nonce: "nonce-abc",
  expiresAt: "2026-02-24T10:45:00",
};

function buildResponseHeader(overrides: {
  presentationId?: string;
  verified?: boolean;
  status?: string;
  timestamp?: string;
  secret?: string;
} = {}): string {
  const presentationId = overrides.presentationId ?? "req_abc123";
  const verified = overrides.verified ?? true;
  const status = overrides.status ?? "VERIFIED";
  const timestamp = overrides.timestamp ?? new Date().toISOString();

  const payloadJson = JSON.stringify({ presentationId, verified, status });
  const signature = hmacSign(`${timestamp}.${payloadJson}`, overrides.secret ?? SECRET);
  const envelope = { payload: payloadJson, signature, timestamp };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

describe("X401Verifier constructor", () => {
  it("throws when required config is missing", () => {
    expect(() => new X401Verifier({ ...BASE_CFG, apiKey: "" })).toThrow();
  });
});

describe("X401Verifier.challenge", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a verification request and builds the 401 challenge from it", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const req = { credential_type: "age_verification", claims: ["age_over_18"] };

    const proofRequest = await verifier.challenge(req);

    expect(proofRequest.body).toEqual({
      verification_data: {
        requestUri: EXPECTED_VD.requestUri,
        nonce: EXPECTED_VD.nonce,
        expiresAt: EXPECTED_VD.expiresAt,
      },
      credential_requirements: req,
      request_id: EXPECTED_VD.requestId,
      nonce: EXPECTED_VD.nonce,
      request_uri: EXPECTED_VD.requestUri,
    });
    const decoded = JSON.parse(Buffer.from(proofRequest.headerValue, "base64url").toString("utf8"));
    expect(decoded).toEqual(proofRequest.body);
  });

  it("forwards stateId to the OID4VP backend", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);

    await verifier.challenge({}, "state-1");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string)).toMatchObject({ stateId: "state-1" });
  });
});

describe("X401Verifier.hasProofResponse", () => {
  it("returns true when the configured header is present", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.hasProofResponse({ [DEFAULT_PROOF_RESPONSE_HEADER]: "abc" })).toBe(true);
  });

  it("matches case-insensitively (e.g. framework-lowercased headers)", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.hasProofResponse({ "proof-response": "abc" })).toBe(true);
  });

  it("returns false when the configured header is absent", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.hasProofResponse({ "content-type": "application/json" })).toBe(false);
  });
});

describe("X401Verifier.readProofResponse", () => {
  it("returns the header value (case-insensitive) when present", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.readProofResponse({ "proof-response": "abc" })).toBe("abc");
  });

  it("returns the first value when the header is an array", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.readProofResponse({ [DEFAULT_PROOF_RESPONSE_HEADER]: ["first", "second"] })).toBe(
      "first",
    );
  });

  it("returns undefined when the configured header is absent", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.readProofResponse({ "content-type": "application/json" })).toBeUndefined();
  });

  it("treats an empty-string header value as absent", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(verifier.readProofResponse({ "proof-response": "" })).toBeUndefined();
  });
});

describe("X401Verifier.verify", () => {
  it("allows a fresh, correctly-signed, verified response", () => {
    const verifier = new X401Verifier(BASE_CFG);

    const verdict = verifier.verify(buildResponseHeader(), "req_abc123");

    expect(verdict).toEqual({ allowed: true, status: "VERIFIED", claims: undefined });
  });

  it("returns a MALFORMED_PROOF_RESPONSE verdict (does not throw) for a malformed header", () => {
    const verifier = new X401Verifier(BASE_CFG);
    const badHeader = Buffer.from("not-json", "utf8").toString("base64url");

    const verdict = verifier.verify(badHeader, "req_abc123");

    expect(verdict).toMatchObject({ allowed: false, errorCode: "MALFORMED_PROOF_RESPONSE" });
  });

  it("returns a BAD_SIGNATURE verdict for a tampered signature", () => {
    const verifier = new X401Verifier(BASE_CFG);
    const header = buildResponseHeader({ secret: "a-different-secret-0123456789ab" });

    const verdict = verifier.verify(header, "req_abc123");

    expect(verdict).toMatchObject({ allowed: false, errorCode: "BAD_SIGNATURE" });
  });

  it("returns a SESSION_MISMATCH verdict when the request id does not match", () => {
    const verifier = new X401Verifier(BASE_CFG);

    const verdict = verifier.verify(buildResponseHeader(), "some-other-request-id");

    expect(verdict).toMatchObject({ allowed: false, errorCode: "SESSION_MISMATCH" });
  });

  it("rethrows non-X401Error exceptions instead of swallowing them", () => {
    const verifier = new X401Verifier(BASE_CFG);

    expect(() => verifier.verify(undefined as unknown as string, "req_abc123")).toThrow(TypeError);
  });
});

describe("X401Verifier replay guard", () => {
  it("rejects a replayed request_id with SESSION_MISMATCH when a replay guard is configured", () => {
    const verifier = new X401Verifier(BASE_CFG, { replayGuard: new InMemoryReplayGuard(300_000) });
    const header = buildResponseHeader();

    expect(verifier.verify(header, "req_abc123").allowed).toBe(true);

    const replay = verifier.verify(header, "req_abc123");
    expect(replay).toMatchObject({ allowed: false, errorCode: "SESSION_MISMATCH" });
  });

  it("does not consume the request_id when no replay guard is configured (no behaviour change)", () => {
    const verifier = new X401Verifier(BASE_CFG);
    const header = buildResponseHeader();

    expect(verifier.verify(header, "req_abc123").allowed).toBe(true);
    expect(verifier.verify(header, "req_abc123").allowed).toBe(true);
  });

  it("does not consume the request_id when the proof is rejected (only allowed proofs are remembered)", () => {
    const guard = new InMemoryReplayGuard(300_000);
    const verifier = new X401Verifier(BASE_CFG, { replayGuard: guard });

    // rejected (session mismatch) — must NOT mark req_abc123 as used
    verifier.verify(buildResponseHeader(), "some-other-request-id");

    // a genuine later proof for req_abc123 still succeeds
    expect(verifier.verify(buildResponseHeader(), "req_abc123").allowed).toBe(true);
  });
});

describe("X401Verifier audit hook", () => {
  it("invokes onVerify with an allowed event on success", () => {
    const events: unknown[] = [];
    const verifier = new X401Verifier(BASE_CFG, { onVerify: (e) => events.push(e) });

    verifier.verify(buildResponseHeader(), "req_abc123");

    expect(events).toEqual([{ allowed: true, requestId: "req_abc123", code: undefined }]);
  });

  it("invokes onVerify with the error code on rejection", () => {
    const events: Array<{ allowed: boolean; requestId: string; code?: string }> = [];
    const verifier = new X401Verifier(BASE_CFG, { onVerify: (e) => events.push(e) });

    verifier.verify(buildResponseHeader(), "some-other-request-id");

    expect(events).toEqual([
      { allowed: false, requestId: "some-other-request-id", code: "SESSION_MISMATCH" },
    ]);
  });

  it("does not let a throwing onVerify break verification", () => {
    const verifier = new X401Verifier(BASE_CFG, {
      onVerify: () => {
        throw new Error("audit sink down");
      },
    });

    expect(verifier.verify(buildResponseHeader(), "req_abc123").allowed).toBe(true);
  });

  it("does not invoke onVerify when verify() rethrows a non-X401Error (no verdict)", () => {
    const onVerify = vi.fn();
    const verifier = new X401Verifier(BASE_CFG, { onVerify });

    expect(() => verifier.verify(undefined as unknown as string, "req_abc123")).toThrow(TypeError);
    expect(onVerify).not.toHaveBeenCalled();
  });
});
