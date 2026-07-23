import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedX401Config } from "../config.js";
import { Oid4vpClient } from "../client.js";
import { X401Error, X401ErrorCode } from "../errors.js";
import { okResponse } from "./test-utils.js";

const baseCfg: ResolvedX401Config = {
  oid4vpBaseUrl: "https://oid4vp.example/api",
  apiKey: "ztx_test_key",
  callbackSecret: "test-callback-secret-0123456789",
  proofResponseTtlSec: 300,
  oid4vpTimeoutMs: 30000,
  expirationMinutes: undefined,
  proofRequestHeader: "PROOF-REQUEST",
  proofResponseHeader: "PROOF-RESPONSE",
};

// Real openid4vp-verifier-be response: ResponseWrapper<CreateVerificationResponseDto> (camelCase).
const backendResponse = {
  object: {
    presentationId: "pres_abc123",
    stateId: "user_session_12345",
    nonce: "nonce-abc",
    status: "CREATED",
    expiresAt: "2026-02-24T10:45:00",
    deepLinkUrl: "zetrix://?request_uri=http://backend/api/v1/presentation/pres_abc123",
  },
  success: true,
};

// What the SDK maps that to.
const expectedVd = {
  requestId: "pres_abc123",
  requestUri: "https://oid4vp.example/api/v1/presentation/pres_abc123",
  nonce: "nonce-abc",
  expiresAt: "2026-02-24T10:45:00",
};

function errorResponse(status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as Response;
}

describe("Oid4vpClient.createVerificationRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to /v1/verification/request with Bearer auth and callbackUrl: null", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(backendResponse));
    const client = new Oid4vpClient(baseCfg);

    const result = await client.createVerificationRequest({ vc_type: "age_over_18" });

    expect(fetch).toHaveBeenCalledWith(
      "https://oid4vp.example/api/v1/verification/request",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer ztx_test_key" }),
      }),
    );
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({
      requirements: { vc_type: "age_over_18" },
      callbackUrl: null,
      stateId: undefined,
      expirationMinutes: undefined,
    });
    expect(result).toEqual(expectedVd);
  });

  it("forwards opts.stateId and cfg.expirationMinutes in the request body", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(backendResponse));
    const client = new Oid4vpClient({ ...baseCfg, expirationMinutes: 10 });

    await client.createVerificationRequest({}, { stateId: "state-1" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string)).toMatchObject({
      stateId: "state-1",
      expirationMinutes: 10,
    });
  });

  it("throws X401Error(REQUEST_CREATE_FAILED) on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(500));
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.REQUEST_CREATE_FAILED,
    });
    await expect(client.createVerificationRequest({})).rejects.toBeInstanceOf(X401Error);
  });

  it("throws X401Error(OID4VP_UNAVAILABLE) on a transport failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.OID4VP_UNAVAILABLE,
    });
  });

  it("passes an AbortSignal to fetch so a hung backend times out", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse(backendResponse));
    const client = new Oid4vpClient(baseCfg);

    await client.createVerificationRequest({});

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.signal).toBeInstanceOf(AbortSignal);
  });

  it("maps a timeout abort to X401Error(OID4VP_UNAVAILABLE)", async () => {
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("The operation was aborted due to timeout", "TimeoutError"),
    );
    const client = new Oid4vpClient({ ...baseCfg, oid4vpTimeoutMs: 10 });

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.OID4VP_UNAVAILABLE,
    });
  });

  it("throws X401Error(REQUEST_CREATE_FAILED) when a 2xx response body is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as Response);
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toBeInstanceOf(X401Error);
    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.REQUEST_CREATE_FAILED,
    });
  });

  it("throws X401Error(REQUEST_CREATE_FAILED) when object is present but missing required fields", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse({ object: { presentationId: "pres_x" }, success: true }));
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.REQUEST_CREATE_FAILED,
    });
  });

  it("throws X401Error(REQUEST_CREATE_FAILED) when the response is not ResponseWrapper-wrapped", async () => {
    // top-level (unwrapped) — no `object` envelope
    vi.mocked(fetch).mockResolvedValue(
      okResponse({ presentationId: "pres_x", nonce: "n", expiresAt: "2026-02-24T10:45:00" }),
    );
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.REQUEST_CREATE_FAILED,
    });
  });

  it("throws X401Error(REQUEST_CREATE_FAILED) when the 2xx body is an array", async () => {
    vi.mocked(fetch).mockResolvedValue(okResponse([1, 2, 3]));
    const client = new Oid4vpClient(baseCfg);

    await expect(client.createVerificationRequest({})).rejects.toMatchObject({
      code: X401ErrorCode.REQUEST_CREATE_FAILED,
    });
  });
});
