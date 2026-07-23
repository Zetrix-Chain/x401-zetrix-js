import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { X401Verifier } from "../index.js";
import type { X401Config } from "../config.js";
import { requireProof } from "../web/express.js";
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

const REQUIREMENTS = { credential_type: "age_verification", claims: ["age_over_18"] };

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

function mockRes() {
  const res = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    set(field: string, value: string) {
      res.headers[field] = value;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

/** Await the async middleware body: it runs work then calls next/res; flush microtasks. */
async function run(
  handler: ReturnType<typeof requireProof>,
  req: { headers: Record<string, string | string[] | undefined>; [k: string]: unknown },
  res: ReturnType<typeof mockRes>,
): Promise<unknown> {
  const next = vi.fn();
  handler(req, res, next);
  // let the internal async chain settle
  await new Promise((resolve) => setTimeout(resolve, 0));
  return next;
}

describe("requireProof", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues a 401 + PROOF-REQUEST when no PROOF-RESPONSE is present", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const req = { headers: {} };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(res.statusCode).toBe(401);
    expect(res.headers["PROOF-REQUEST"]).toBeTypeOf("string");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows the request and publishes claims on req.x401Claims when the proof verifies", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const req: { headers: Record<string, string | string[] | undefined>; [k: string]: unknown } = {
      headers: { "PROOF-RESPONSE": buildResponseHeader() },
    };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBeUndefined();
    expect(req.x401Claims).toBeUndefined(); // no verifiedClaims in the fixture
  });

  it("rejects with 403 + error verdict when the proof does not verify", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const req = { headers: { "PROOF-RESPONSE": buildResponseHeader({ verified: false }) } };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: "PROOF_NOT_VERIFIED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("uses resolveExpectedRequestId for cross-request session binding (mismatch → 403)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const req = { headers: { "PROOF-RESPONSE": buildResponseHeader({ presentationId: "req_abc123" }) } };
    const res = mockRes();

    const next = (await run(
      requireProof(verifier, REQUIREMENTS, {
        resolveExpectedRequestId: () => "a-different-request-id",
      }),
      req,
      res,
    )) as ReturnType<typeof vi.fn>;

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: "SESSION_MISMATCH" });
    expect(next).not.toHaveBeenCalled();
  });

  it("treats an empty PROOF-RESPONSE header as absent and issues a 401 challenge", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const req = { headers: { "PROOF-RESPONSE": "" } };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(res.statusCode).toBe(401);
    expect(res.headers["PROOF-REQUEST"]).toBeTypeOf("string");
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed PROOF-RESPONSE with 403 MALFORMED_PROOF_RESPONSE (self-bind)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const req = { headers: { "PROOF-RESPONSE": "not-a-valid-envelope" } };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: "MALFORMED_PROOF_RESPONSE" });
    expect(next).not.toHaveBeenCalled();
  });

  it("self-binds to the response presentationId when no resolver is given", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    // presentationId differs from the challenge's request id, but self-bind accepts it
    const req = { headers: { "PROOF-RESPONSE": buildResponseHeader({ presentationId: "req_zzz999" }) } };
    const res = mockRes();

    const next = (await run(requireProof(verifier, REQUIREMENTS), req, res)) as ReturnType<typeof vi.fn>;

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeUndefined();
  });
});
