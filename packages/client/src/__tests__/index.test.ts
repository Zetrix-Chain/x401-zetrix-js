import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { X401Wallet } from "../index.js";
import { X401WalletErrorCode } from "../errors.js";
import type { X401WalletConfig } from "../config.js";
import type { HolderSigner, VcProofProvider } from "../signer.js";
import type { PresentationDefinition } from "../model.js";

const CFG: X401WalletConfig = { oid4vpBaseUrl: "https://oid4vp.example/api" };
const HOLDER_DID = "did:zid:holder";

const CHALLENGE_BODY = {
  verification_data: {
    requestUri: "https://oid4vp.example/request/abc",
    nonce: "verifier-nonce",
    expiresAt: "2026-02-23T10:35:00Z",
  },
  credential_requirements: { credential_type: "age_verification" },
  request_id: "req_abc123",
  nonce: "verifier-nonce",
  request_uri: "https://oid4vp.example/request/abc",
};

function challengeHeader(): string {
  return Buffer.from(JSON.stringify(CHALLENGE_BODY), "utf8").toString("base64url");
}

const DEF: PresentationDefinition = {
  requestId: "req_abc123",
  credentialQuery: { credential_type: "age_verification" },
  nonce: "verifier-nonce",
  responseUri: "https://oid4vp.example/api/v1/presentation/submit",
  expiresAt: "2026-02-23T10:35:00Z",
};

const PAYLOAD_JSON = '{"presentationId":"req_abc123","verified":true,"status":"VERIFIED"}';

function deps(): { signer: HolderSigner; vc: VcProofProvider } {
  return {
    signer: { sign: vi.fn(async () => ({ signBlob: "sig-blob", publicKey: "hb-pub" })) },
    vc: {
      createVp: vi.fn(async () => ({
        vp: { some: "vp" },
        ed25519PublicKey: "ed-pub",
        bbsPublicKey: "bbs-pub",
        presentationSubmission: {
          id: "sub_1",
          definition_id: "req_abc123",
          descriptor_map: [{ id: "age_verification", format: "ldp_vc", path: "$.verifiableCredential[0]" }],
        },
      })),
    },
  };
}

function defResponse(): Response {
  // Real backend: ResponseWrapper<PresentationRequestResponseDto> (snake_case).
  return {
    ok: true,
    status: 200,
    json: async () => ({
      object: {
        presentation_id: DEF.requestId,
        credential_query: DEF.credentialQuery,
        nonce: DEF.nonce,
        response_uri: DEF.responseUri,
        expires_at: DEF.expiresAt,
      },
      success: true,
    }),
  } as Response;
}

function submitResponse(): Response {
  // Real backend: ResponseWrapper with signed_result field + X-Callback-* headers.
  return {
    ok: true,
    status: 200,
    json: async () => ({ object: { signed_result: PAYLOAD_JSON }, success: true }),
    headers: {
      get: (name: string) =>
        ({ "x-callback-signature": "sig-abc", "x-callback-timestamp": "2026-02-23T10:30:00Z" })[
          name.toLowerCase()
        ] ?? null,
    },
  } as unknown as Response;
}

describe("X401Wallet.parseChallenge", () => {
  it("parses a PROOF-REQUEST header into a ProofRequest", () => {
    const wallet = new X401Wallet(CFG, deps());

    const req = wallet.parseChallenge(challengeHeader());

    expect(req.requestId).toBe("req_abc123");
    expect(req.nonce).toBe("verifier-nonce");
  });
});

describe("X401Wallet.respondToChallenge", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("runs the full flow: parse → fetch definition → build VP → submit → package", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(defResponse()).mockResolvedValueOnce(submitResponse());
    const wallet = new X401Wallet(CFG, deps());

    const resp = await wallet.respondToChallenge(challengeHeader(), HOLDER_DID);

    expect(resp.presentationId).toBe("req_abc123");
    expect(resp.verified).toBe(true);
    expect(resp.payloadJson).toBe(PAYLOAD_JSON); // verbatim
    // header value is a replayable base64url envelope
    const envelope = JSON.parse(Buffer.from(resp.headerValue, "base64url").toString("utf8"));
    expect(envelope.payload).toBe(PAYLOAD_JSON);
    // the submit body (2nd fetch) carries the required presentation_submission
    const submitBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(submitBody.presentation_submission).toMatchObject({ id: "sub_1", definition_id: "req_abc123" });
  });

  it("accepts an already-parsed ProofRequest too", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(defResponse()).mockResolvedValueOnce(submitResponse());
    const wallet = new X401Wallet(CFG, deps());

    const parsed = wallet.parseChallenge(challengeHeader());
    const resp = await wallet.respondToChallenge(parsed, HOLDER_DID);

    expect(resp.status).toBe("VERIFIED");
  });

  it("threads deps.submitAuth through to the submit call (sets wallet-auth headers)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(defResponse()).mockResolvedValueOnce(submitResponse());
    const submitAuth = vi.fn(async () => ({ publicKey: "wallet-pub", signedData: "wallet-sig" }));
    const wallet = new X401Wallet(CFG, { ...deps(), submitAuth });

    await wallet.respondToChallenge(challengeHeader(), HOLDER_DID);

    expect(submitAuth).toHaveBeenCalledTimes(1);
    // the submit fetch is the 2nd call — it must carry the wallet-auth headers
    const submitInit = vi.mocked(fetch).mock.calls[1][1];
    expect(submitInit!.headers).toMatchObject({
      "X-Wallet-Public-Key": "wallet-pub",
      "X-Wallet-Signed-Data": "wallet-sig",
    });
  });
});

describe("X401Wallet nonce binding (anti-replay / anti-substitution)", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("binds the challenge verifier nonce into VP derivation and the holder-binding signature", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(defResponse()).mockResolvedValueOnce(submitResponse());
    const d = deps();
    const wallet = new X401Wallet(CFG, d);

    await wallet.respondToChallenge(challengeHeader(), HOLDER_DID);

    expect(d.signer.sign).toHaveBeenCalledWith("verifier-nonce");
    expect(d.vc.createVp).toHaveBeenCalledWith(expect.objectContaining({ nonce: "verifier-nonce" }));
  });

  it("rejects a definition whose nonce does not match the challenge nonce", async () => {
    // A well-formed (wrapped) definition, but with a tampered verifier nonce.
    const mismatched = {
      object: {
        presentation_id: DEF.requestId,
        credential_query: DEF.credentialQuery,
        nonce: "tampered-nonce",
        response_uri: DEF.responseUri,
        expires_at: DEF.expiresAt,
      },
      success: true,
    };
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, json: async () => mismatched } as Response);
    const wallet = new X401Wallet(CFG, deps());

    await expect(wallet.respondToChallenge(challengeHeader(), HOLDER_DID)).rejects.toMatchObject({
      code: X401WalletErrorCode.DEFINITION_FETCH_FAILED,
    });
  });
});

describe("X401Wallet granular steps", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it("fetchDefinition + buildVp + submit compose to a PROOF-RESPONSE", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(defResponse()).mockResolvedValueOnce(submitResponse());
    const wallet = new X401Wallet(CFG, deps());

    const def = await wallet.fetchDefinition("req_abc123");
    const vp = await wallet.buildVp(def, HOLDER_DID);
    const resp = await wallet.submit(def, vp);

    expect(resp.presentationId).toBe("req_abc123");
    expect(vp.holderBinding).toEqual({ signBlob: "sig-blob", publicKey: "hb-pub" });
  });
});
