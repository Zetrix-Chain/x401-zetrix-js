import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Oid4vpWalletClient } from "../oid4vp-client.js";
import { X401WalletErrorCode } from "../errors.js";
import type { PresentationDefinition, Vp } from "../model.js";

const CFG = {
  oid4vpBaseUrl: "https://oid4vp.example/api",
  proofRequestHeader: "PROOF-REQUEST",
  proofResponseHeader: "PROOF-RESPONSE",
  oid4vpTimeoutMs: 30000,
};

// The mapped PresentationDefinition the SDK returns (camelCase).
const DEF: PresentationDefinition = {
  requestId: "req_abc123",
  credentialQuery: { credential_type: "age_verification" },
  nonce: "verifier-nonce",
  responseUri: "https://oid4vp.example/api/v1/presentation/req_abc123/submit",
  expiresAt: "2026-02-23T10:35:00Z",
};

/** The real backend GET-presentation response: ResponseWrapper<PresentationRequestResponseDto>. */
function wrappedDefinition(overrides: Record<string, unknown> = {}): unknown {
  return {
    object: {
      presentation_id: DEF.requestId,
      credential_query: DEF.credentialQuery,
      nonce: DEF.nonce,
      response_uri: DEF.responseUri,
      response_mode: "direct_post",
      state: "user_session_12345",
      expires_at: DEF.expiresAt,
      ...overrides,
    },
    success: true,
  };
}

const VP: Vp = {
  vp: { some: "vp" },
  ed25519PublicKey: "ed-pub",
  bbsPublicKey: "bbs-pub",
  presentationSubmission: {
    id: "sub_1",
    definition_id: "req_abc123",
    descriptor_map: [{ id: "age_verification", format: "ldp_vc", path: "$.verifiableCredential[0]" }],
  },
  holderBinding: { signBlob: "sig", publicKey: "hb-pub" },
};

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}), text: async () => "" } as Response;
}

/** Real sync-HMAC submit response: ResponseWrapper with a `signed_result` field + callback headers. */
function submitResponse(signedResult: string, signature: string, timestamp: string): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: { response: "success", verified: true, status: "VERIFIED", signed_result: signedResult },
      success: true,
    }),
    headers: {
      get: (name: string) =>
        ({ "x-callback-signature": signature, "x-callback-timestamp": timestamp })[
          name.toLowerCase()
        ] ?? null,
    },
  } as unknown as Response;
}

describe("Oid4vpWalletClient.getPresentation", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("GETs /v1/presentation/{id}, unwraps ResponseWrapper, and maps snake_case → the definition", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(wrappedDefinition()));
    const client = new Oid4vpWalletClient(CFG);

    const def = await client.getPresentation("req_abc123");

    expect(fetch).toHaveBeenCalledWith(
      "https://oid4vp.example/api/v1/presentation/req_abc123",
      expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    );
    expect(def).toEqual(DEF);
  });

  it("resolves the definition when the backend omits expires_at (expiresAt is optional)", async () => {
    // The live sandbox definition carries no `expires_at` — confirmed 2026-07-17. It must
    // still resolve, since expiresAt is informational and never used to build/submit the VP.
    vi.mocked(fetch).mockResolvedValue(
      okJson({
        object: {
          presentation_id: DEF.requestId,
          credential_query: DEF.credentialQuery,
          nonce: DEF.nonce,
          response_uri: DEF.responseUri,
          response_mode: "direct_post",
          state: "user_session_12345",
          abort_uri: "https://oid4vp.example/api/v1/presentation/req_abc123/abort",
        },
        success: true,
      }),
    );
    const client = new Oid4vpWalletClient(CFG);

    const def = await client.getPresentation("req_abc123");

    expect(def.requestId).toBe(DEF.requestId);
    expect(def.nonce).toBe(DEF.nonce);
    expect(def.responseUri).toBe(DEF.responseUri);
    expect(def.expiresAt).toBeUndefined();
  });

  it("maps expires_at into expiresAt when the backend does supply it", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(wrappedDefinition()));
    const client = new Oid4vpWalletClient(CFG);

    const def = await client.getPresentation("req_abc123");

    expect(def.expiresAt).toBe(DEF.expiresAt);
  });

  it("throws DEFINITION_FETCH_FAILED when the returned definition's presentation_id does not match", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson(wrappedDefinition({ presentation_id: "req_other" })));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });

  it("throws DEFINITION_FETCH_FAILED when the response is not ResponseWrapper-wrapped", async () => {
    // top-level (unwrapped) definition — no `object` envelope
    vi.mocked(fetch).mockResolvedValue(okJson({ presentation_id: "req_abc123", nonce: "n" }));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });

  it("throws DEFINITION_FETCH_FAILED when the body is not an object", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson([1, 2, 3]));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });

  it("throws DEFINITION_FETCH_FAILED on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(404));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });

  it("throws OID4VP_UNAVAILABLE on a transport failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.OID4VP_UNAVAILABLE,
    });
  });

  it("throws DEFINITION_FETCH_FAILED when object is present but missing required fields", async () => {
    vi.mocked(fetch).mockResolvedValue(okJson({ object: { presentation_id: "req_abc123" }, success: true }));
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });

  it("throws DEFINITION_FETCH_FAILED when the 2xx body is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
    } as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(client.getPresentation("req_abc123")).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });
});

describe("Oid4vpWalletClient.submitPresentation", () => {
  const payloadJson = '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED"}';
  const signature = "sig-abc";
  const timestamp = "2026-02-23T10:30:00Z";

  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs to /v1/presentation/submit and packages the signed result", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);

    const resp = await client.submitPresentation(DEF, VP, {
      ed25519PublicKey: "ed-pub",
      bbsPublicKey: "bbs-pub",
    });

    expect(fetch).toHaveBeenCalledWith(
      DEF.responseUri,
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
    expect(resp.payloadJson).toBe(payloadJson); // verbatim
    expect(resp.signature).toBe(signature);
    expect(resp.timestamp).toBe(timestamp);
    expect(resp.presentationId).toBe("req_abc123");
    expect(resp.verified).toBe(true);
  });

  it("sends the backend submit-body contract (presentation_id, vp_token, public keys)", async () => {
    // Field names verified against openid4vp-verifier-be SubmitPresentationReqDto:
    // presentation_id, vp_token, ed25519_public_key, bbs_public_key.
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);

    await client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(init!.body as string);
    expect(sent).toMatchObject({
      presentation_id: "req_abc123",
      vp_token: VP.vp,
      presentation_submission: VP.presentationSubmission, // backend @NotNull required field
      ed25519_public_key: "ed-pub",
      bbs_public_key: "bbs-pub",
    });
    // must NOT use the old (wrong) field names the backend binds as null
    expect(sent).not.toHaveProperty("request_id");
    expect(sent).not.toHaveProperty("vp");
  });

  it("sends X-Wallet-Public-Key / X-Wallet-Signed-Data when a submitAuth provider is supplied", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);
    const submitAuth = vi.fn(async () => ({
      publicKey: "wallet-ed25519-pubkey-hex",
      signedData: "ed25519-sig-over-holder-address-hex",
    }));

    await client.submitPresentation(
      DEF,
      VP,
      { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" },
      submitAuth,
    );

    expect(submitAuth).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.headers).toMatchObject({
      "X-Wallet-Public-Key": "wallet-ed25519-pubkey-hex",
      "X-Wallet-Signed-Data": "ed25519-sig-over-holder-address-hex",
    });
  });

  it("omits wallet-auth headers when no submitAuth is supplied (back-compat)", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);

    await client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.headers).not.toHaveProperty("X-Wallet-Public-Key");
  });

  it("throws SIGN_FAILED when the submitAuth provider throws", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);
    const submitAuth = vi.fn(async () => {
      throw new Error("HSM unavailable");
    });

    await expect(
      client.submitPresentation(
        DEF,
        VP,
        { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" },
        submitAuth,
      ),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SIGN_FAILED });
    expect(fetch).not.toHaveBeenCalled(); // auth failed before any submit left the wallet
  });

  it("throws SUBMIT_FAILED on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValue(errorResponse(500));
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("includes the backend response body in the SUBMIT_FAILED error message", async () => {
    const detail =
      '{"messages":[{"message":"Missing X-Wallet-Public-Key header [WALLET_AUTH_MISSING_PUBLIC_KEY]"}]}';
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
      text: async () => detail,
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toThrow(/WALLET_AUTH_MISSING_PUBLIC_KEY/);
  });

  it("throws OID4VP_UNAVAILABLE on a transport failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("ECONNRESET"));
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.OID4VP_UNAVAILABLE });
  });

  it("throws SUBMIT_FAILED when responseUri is off-origin from oid4vpBaseUrl (no exfiltration)", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);
    const offOrigin = { ...DEF, responseUri: "https://evil.example/v1/presentation/submit" };

    await expect(
      client.submitPresentation(offOrigin, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
    expect(fetch).not.toHaveBeenCalled(); // rejected before any request left the wallet
  });

  it("throws SUBMIT_FAILED when responseUri is not a valid URL", async () => {
    vi.mocked(fetch).mockResolvedValue(submitResponse(payloadJson, signature, timestamp));
    const client = new Oid4vpWalletClient(CFG);
    const badUri = { ...DEF, responseUri: "not a url" };

    await expect(
      client.submitPresentation(badUri, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("throws SUBMIT_FAILED when the response body is not valid JSON", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token");
      },
      headers: { get: () => "x" },
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("throws SUBMIT_FAILED when the response has no signed_result payload", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: { verified: true, status: "VERIFIED" }, success: true }),
      headers: { get: () => "x" },
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("throws SUBMIT_FAILED when the response is not ResponseWrapper-wrapped", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }), // no `object`
      headers: { get: () => "x" },
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("throws SUBMIT_FAILED when the submit body is not an object", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [1, 2, 3],
      headers: { get: () => "x" },
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });

  it("throws SUBMIT_FAILED when the sync-HMAC callback headers are missing", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ object: { signed_result: payloadJson }, success: true }),
      headers: { get: () => null },
    } as unknown as Response);
    const client = new Oid4vpWalletClient(CFG);

    await expect(
      client.submitPresentation(DEF, VP, { ed25519PublicKey: "ed-pub", bbsPublicKey: "bbs-pub" }),
    ).rejects.toMatchObject({ code: X401WalletErrorCode.SUBMIT_FAILED });
  });
});
