import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryReplayGuard } from "x401-zetrix-server";
import { createMockOid4vp } from "./mock-oid4vp.js";
import { makeResourceServer } from "./resource-server.js";
import { makeWallet } from "./wallet.js";

const BASE_URL = "https://mock-oid4vp.test/api";
const API_KEY = "ztx_e2e_key";
const CALLBACK_SECRET = "test-callback-secret-0123456789";
const HOLDER_DID = "did:zid:holder";
const REQUIREMENTS = { credential_type: "age_verification", claims: ["age_over_18"] };

/** Decode / re-encode the base64url PROOF-RESPONSE envelope (to tamper with it). */
function decodeEnvelope(headerValue: string): { payload: string; signature: string; timestamp: string } {
  return JSON.parse(Buffer.from(headerValue, "base64url").toString("utf8"));
}
function encodeEnvelope(env: unknown): string {
  return Buffer.from(JSON.stringify(env), "utf8").toString("base64url");
}

function installMock(overrides: { signTimestamp?: () => string } = {}) {
  const mock = createMockOid4vp({ baseUrl: BASE_URL, callbackSecret: CALLBACK_SECRET, ...overrides });
  vi.stubGlobal("fetch", vi.fn(mock.fetch));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("x401 end-to-end (server <-> wallet over a mock OID4VP backend)", () => {
  it("happy path: challenge -> wallet responds -> server verifies -> allowed", async () => {
    installMock();
    const server = makeResourceServer({ oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET });
    const wallet = makeWallet(BASE_URL);

    // RS issues the 401 challenge.
    const challenge = await server.challenge(REQUIREMENTS);
    const expectedRequestId = challenge.body.request_id;

    // Wallet answers the PROOF-REQUEST and produces a PROOF-RESPONSE.
    const proofResponse = await wallet.respondToChallenge(challenge.headerValue, HOLDER_DID);

    // Agent replays it; RS verifies.
    const verdict = server.verify(proofResponse.headerValue, expectedRequestId);

    expect(verdict).toEqual({ allowed: true, status: "VERIFIED", claims: { age_over_18: true } });
  });

  it("granular steps compose to the same result", async () => {
    installMock();
    const server = makeResourceServer({ oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET });
    const wallet = makeWallet(BASE_URL);

    const challenge = await server.challenge(REQUIREMENTS);
    const req = wallet.parseChallenge(challenge.headerValue);
    const def = await wallet.fetchDefinition(req.requestId);
    const vp = await wallet.buildVp(def, HOLDER_DID);
    const proofResponse = await wallet.submit(def, vp);

    expect(server.verify(proofResponse.headerValue, req.requestId).allowed).toBe(true);
  });

  it("tampered signature is rejected with BAD_SIGNATURE", async () => {
    installMock();
    const server = makeResourceServer({ oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET });
    const wallet = makeWallet(BASE_URL);

    const challenge = await server.challenge(REQUIREMENTS);
    const proofResponse = await wallet.respondToChallenge(challenge.headerValue, HOLDER_DID);

    const env = decodeEnvelope(proofResponse.headerValue);
    // Flip the first base64 char, preserving length + padding so the signature still
    // decodes to 32 bytes — this exercises the timing-safe content compare, not the
    // length guard.
    const flipped = (env.signature[0] === "A" ? "B" : "A") + env.signature.slice(1);
    const tampered = encodeEnvelope({ ...env, signature: flipped });

    const verdict = server.verify(tampered, challenge.body.request_id);
    expect(verdict).toMatchObject({ allowed: false, errorCode: "BAD_SIGNATURE" });
  });

  it("a proof bound to a different request is rejected with SESSION_MISMATCH", async () => {
    installMock();
    const server = makeResourceServer({ oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET });
    const wallet = makeWallet(BASE_URL);

    const challenge = await server.challenge(REQUIREMENTS);
    const proofResponse = await wallet.respondToChallenge(challenge.headerValue, HOLDER_DID);

    const verdict = server.verify(proofResponse.headerValue, "some-other-request-id");
    expect(verdict).toMatchObject({ allowed: false, errorCode: "SESSION_MISMATCH" });
  });

  it("replaying the same proof is rejected on the second use when a replay guard is set", async () => {
    installMock();
    const server = makeResourceServer(
      { oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET },
      { replayGuard: new InMemoryReplayGuard(300_000) },
    );
    const wallet = makeWallet(BASE_URL);

    const challenge = await server.challenge(REQUIREMENTS);
    const expectedRequestId = challenge.body.request_id;
    const proofResponse = await wallet.respondToChallenge(challenge.headerValue, HOLDER_DID);

    expect(server.verify(proofResponse.headerValue, expectedRequestId).allowed).toBe(true);
    expect(server.verify(proofResponse.headerValue, expectedRequestId)).toMatchObject({
      allowed: false,
      errorCode: "SESSION_MISMATCH",
    });
  });

  it("a stale signed timestamp is rejected with STALE_TIMESTAMP", async () => {
    const staleTs = new Date(Date.now() - 400_000).toISOString(); // well outside the 300s window
    installMock({ signTimestamp: () => staleTs });
    const server = makeResourceServer({ oid4vpBaseUrl: BASE_URL, apiKey: API_KEY, callbackSecret: CALLBACK_SECRET });
    const wallet = makeWallet(BASE_URL);

    const challenge = await server.challenge(REQUIREMENTS);
    const proofResponse = await wallet.respondToChallenge(challenge.headerValue, HOLDER_DID);

    const verdict = server.verify(proofResponse.headerValue, challenge.body.request_id);
    expect(verdict).toMatchObject({ allowed: false, errorCode: "STALE_TIMESTAMP" });
  });
});
