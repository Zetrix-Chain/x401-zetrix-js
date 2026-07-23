import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { X401Verifier } from "../index.js";
import type { X401Config } from "../config.js";
import { x401Plugin } from "../web/fastify.js";
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
  overrides: { presentationId?: string; verified?: boolean; status?: string } = {},
): string {
  const presentationId = overrides.presentationId ?? "req_abc123";
  const verified = overrides.verified ?? true;
  const status = overrides.status ?? "VERIFIED";
  const timestamp = new Date().toISOString();

  const payloadJson = JSON.stringify({ presentationId, verified, status });
  const signature = hmacSign(`${timestamp}.${payloadJson}`, SECRET);
  const envelope = { payload: payloadJson, signature, timestamp };

  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
}

/** Minimal fake Fastify instance that captures the registered onRequest hook. */
function fakeInstance() {
  const hooks: Record<string, (req: unknown, reply: unknown) => Promise<unknown>> = {};
  return {
    addHook(name: string, fn: (req: unknown, reply: unknown) => Promise<unknown>) {
      hooks[name] = fn;
    },
    onRequest: () => hooks["onRequest"],
  };
}

function fakeReply() {
  const reply = {
    statusCode: undefined as number | undefined,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    sent: false,
    code(n: number) {
      reply.statusCode = n;
      return reply;
    },
    header(k: string, v: string) {
      reply.headers[k] = v;
      return reply;
    },
    send(payload: unknown) {
      reply.body = payload;
      reply.sent = true;
      return reply;
    },
  };
  return reply;
}

describe("x401Plugin", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an onRequest hook that 401s + PROOF-REQUEST when no proof is present", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();

    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });
    const hook = instance.onRequest();
    expect(hook).toBeTypeOf("function");

    const req = { headers: {} as Record<string, string | string[] | undefined> };
    const reply = fakeReply();
    await hook!(req, reply);

    expect(reply.statusCode).toBe(401);
    expect(reply.headers["PROOF-REQUEST"]).toBeTypeOf("string");
    expect(reply.sent).toBe(true);
  });

  it("allows and publishes claims on request.x401Claims when the proof verifies", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const req: { headers: Record<string, string | string[] | undefined>; [k: string]: unknown } = {
      headers: { "PROOF-RESPONSE": buildResponseHeader() },
    };
    const reply = fakeReply();
    await instance.onRequest()!(req, reply);

    expect(reply.sent).toBe(false);
    expect(reply.statusCode).toBeUndefined();
    expect(req.x401Claims).toBeUndefined(); // no verifiedClaims in fixture
  });

  it("rejects with 403 + error verdict when the proof does not verify", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const req = { headers: { "PROOF-RESPONSE": buildResponseHeader({ verified: false }) } };
    const reply = fakeReply();
    await instance.onRequest()!(req, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toMatchObject({ code: "PROOF_NOT_VERIFIED" });
    expect(reply.sent).toBe(true);
  });

  it("rejects a malformed PROOF-RESPONSE with 403 MALFORMED_PROOF_RESPONSE (self-bind)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const req = { headers: { "PROOF-RESPONSE": "not-a-valid-envelope" } };
    const reply = fakeReply();
    await instance.onRequest()!(req, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toMatchObject({ code: "MALFORMED_PROOF_RESPONSE" });
  });

  it("returns reply from the hook after sending a 401 (so Fastify halts the lifecycle)", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(VERIFICATION_DATA));
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const reply = fakeReply();
    const ret = await instance.onRequest()!({ headers: {} }, reply);

    expect(ret).toBe(reply);
  });

  it("returns reply from the hook after a 403 rejection (so Fastify halts the lifecycle)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const reply = fakeReply();
    const ret = await instance.onRequest()!(
      { headers: { "PROOF-RESPONSE": buildResponseHeader({ verified: false }) } },
      reply,
    );

    expect(ret).toBe(reply);
  });

  it("returns undefined from the hook when the proof verifies (lifecycle continues)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, { verifier, requirements: REQUIREMENTS });

    const reply = fakeReply();
    const ret = await instance.onRequest()!(
      { headers: { "PROOF-RESPONSE": buildResponseHeader() } },
      reply,
    );

    expect(ret).toBeUndefined();
  });

  it("uses resolveExpectedRequestId for session binding (mismatch → 403)", async () => {
    const verifier = new X401Verifier(BASE_CFG);
    const instance = fakeInstance();
    await x401Plugin(instance, {
      verifier,
      requirements: REQUIREMENTS,
      resolveExpectedRequestId: () => "a-different-request-id",
    });

    const req = { headers: { "PROOF-RESPONSE": buildResponseHeader() } };
    const reply = fakeReply();
    await instance.onRequest()!(req, reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.body).toMatchObject({ code: "SESSION_MISMATCH" });
  });
});
