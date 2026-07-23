/**
 * OID4VP wallet client (Part B). See docs/05-api-reference-client.md.
 *
 * Uses global `fetch` (Node 18+). Maps transport failure → X401WalletError(OID4VP_UNAVAILABLE),
 * non-2xx on fetch → DEFINITION_FETCH_FAILED, non-2xx on submit → SUBMIT_FAILED.
 */

import type { ResolvedX401WalletConfig } from "./config.js";
import { X401WalletError, X401WalletErrorCode } from "./errors.js";
import { isNonBlankString, isRecord } from "./guards.js";
import type { PresentationDefinition, ProofResponse, Vp } from "./model.js";
import { packageProofResponse } from "./proof-response.js";
import type { SubmitAuthProvider } from "./signer.js";

/**
 * Map the real OID4VP `GET /v1/presentation/{id}` response to {@link PresentationDefinition}.
 *
 * The backend wraps every response in `ResponseWrapper<T>` (`{ object, messages, success }`)
 * and returns `PresentationRequestResponseDto` (snake_case: `presentation_id`,
 * `credential_query`, `nonce`, `response_uri`, `response_mode`, `state`, `abort_uri`).
 *
 * NOTE: the live sandbox definition carries **no `expires_at`** (confirmed against the
 * verifier 2026-07-17) — it is not required to build or submit the VP, so it is mapped only
 * when present. The required fields are the four the wallet actually uses: `presentation_id`,
 * `credential_query`, `nonce`, `response_uri`.
 */
function mapPresentationDefinition(body: unknown): PresentationDefinition {
  const obj = isRecord(body) ? body.object : undefined;
  if (
    !isRecord(obj) ||
    !isNonBlankString(obj.presentation_id) ||
    obj.credential_query === undefined ||
    !isNonBlankString(obj.nonce) ||
    !isNonBlankString(obj.response_uri)
  ) {
    throw new X401WalletError(
      X401WalletErrorCode.DEFINITION_FETCH_FAILED,
      "OID4VP backend returned a malformed presentation definition",
    );
  }
  return {
    requestId: obj.presentation_id,
    credentialQuery: obj.credential_query,
    nonce: obj.nonce,
    responseUri: obj.response_uri,
    ...(isNonBlankString(obj.expires_at) ? { expiresAt: obj.expires_at } : {}),
  };
}

export class Oid4vpWalletClient {
  private readonly cfg: ResolvedX401WalletConfig;

  constructor(cfg: ResolvedX401WalletConfig) {
    this.cfg = cfg;
  }

  /** Reject a submit target that isn't on the configured backend's origin. */
  private assertSameOrigin(responseUri: string): void {
    let target: URL;
    let base: URL;
    try {
      target = new URL(responseUri);
      base = new URL(this.cfg.oid4vpBaseUrl);
    } catch (cause) {
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        `OID4VP responseUri is not a valid URL: ${responseUri}`,
        cause,
      );
    }
    if (target.origin !== base.origin) {
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        `OID4VP responseUri origin ${target.origin} is not the configured backend origin ${base.origin}`,
      );
    }
  }

  /** `GET /v1/presentation/{id}` — fetch the DCQL / presentation definition. */
  async getPresentation(requestId: string): Promise<PresentationDefinition> {
    let response: Response;
    try {
      response = await fetch(
        `${this.cfg.oid4vpBaseUrl}/v1/presentation/${encodeURIComponent(requestId)}`,
        { method: "GET", signal: AbortSignal.timeout(this.cfg.oid4vpTimeoutMs) },
      );
    } catch (cause) {
      throw new X401WalletError(X401WalletErrorCode.OID4VP_UNAVAILABLE, "OID4VP backend unreachable", cause);
    }

    if (!response.ok) {
      throw new X401WalletError(
        X401WalletErrorCode.DEFINITION_FETCH_FAILED,
        `OID4VP backend returned ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new X401WalletError(
        X401WalletErrorCode.DEFINITION_FETCH_FAILED,
        "OID4VP backend returned a non-JSON presentation definition",
        cause,
      );
    }
    const def = mapPresentationDefinition(body);
    if (def.requestId !== requestId) {
      throw new X401WalletError(
        X401WalletErrorCode.DEFINITION_FETCH_FAILED,
        "OID4VP presentation definition requestId does not match the requested id",
      );
    }
    return def;
  }

  /**
   * `POST /v1/presentation/submit` — submit the VP (+ `ed25519_public_key`, `bbs_public_key`).
   * In sync-HMAC mode the response body is the verbatim signed payload and the HMAC +
   * timestamp arrive as `X-Callback-Signature` / `X-Callback-Timestamp` headers.
   */
  async submitPresentation(
    def: PresentationDefinition,
    vp: Vp,
    keys: { ed25519PublicKey: string; bbsPublicKey: string },
    submitAuth?: SubmitAuthProvider,
  ): Promise<ProofResponse> {
    // The presentation definition carries a backend-supplied `responseUri`. Only POST
    // signature material to it if it shares the configured backend's origin — otherwise a
    // spoofed/mis-issued definition could exfiltrate the VP + holder-binding signature.
    this.assertSameOrigin(def.responseUri);

    // The verifier's WalletAuthenticationFilter gates submit on `X-Wallet-Public-Key` +
    // `X-Wallet-Signed-Data` (an Ed25519 signature over the holder's own address). Produced by
    // the injected provider; omitted (no headers) when none is supplied, for back-compat.
    let authHeaders: Record<string, string> = {};
    if (submitAuth) {
      try {
        const auth = await submitAuth();
        authHeaders = {
          "X-Wallet-Public-Key": auth.publicKey,
          "X-Wallet-Signed-Data": auth.signedData,
        };
      } catch (cause) {
        throw new X401WalletError(
          X401WalletErrorCode.SIGN_FAILED,
          "failed to produce OID4VP submit wallet-auth headers",
          cause,
        );
      }
    }

    let response: Response;
    try {
      response = await fetch(def.responseUri, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        // Field names per openid4vp-verifier-be `SubmitPresentationReqDto`
        // (presentation_id, vp_token, ed25519_public_key, bbs_public_key). `holder_binding`
        // is not in the DTO (backend ignores unknown fields) but is kept for wallets that
        // still consume it; holder authentication is carried by the X-Wallet-* headers above.
        body: JSON.stringify({
          presentation_id: def.requestId,
          vp_token: vp.vp,
          presentation_submission: vp.presentationSubmission,
          holder_binding: vp.holderBinding,
          ed25519_public_key: keys.ed25519PublicKey,
          bbs_public_key: keys.bbsPublicKey,
        }),
        signal: AbortSignal.timeout(this.cfg.oid4vpTimeoutMs),
      });
    } catch (cause) {
      throw new X401WalletError(X401WalletErrorCode.OID4VP_UNAVAILABLE, "OID4VP backend unreachable", cause);
    }

    if (!response.ok) {
      // Surface the backend body — a bare status (e.g. 401) hides *why* (a wallet-auth
      // rejection reads `... [WALLET_AUTH_MISSING_PUBLIC_KEY]`), which made this hard to
      // diagnose live in the first place.
      const detail = await response.text().catch(() => "");
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        `OID4VP backend returned ${response.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`,
      );
    }

    // Sync-HMAC mode: the backend wraps the result in ResponseWrapper and the HMAC-signed
    // payload is the `signed_result` STRING field (the RS recomputes HMAC over
    // `timestamp . signed_result`) — NOT the whole response body. The signature + timestamp
    // arrive as X-Callback-Signature / X-Callback-Timestamp headers.
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        "OID4VP backend returned a non-JSON submit response",
        cause,
      );
    }
    const obj = isRecord(body) ? body.object : undefined;
    const signedResult = isRecord(obj) ? obj.signed_result : undefined;
    if (!isNonBlankString(signedResult)) {
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        "OID4VP sync-HMAC response is missing the signed_result payload",
      );
    }
    const signature = response.headers.get("X-Callback-Signature");
    const timestamp = response.headers.get("X-Callback-Timestamp");
    if (!signature || !timestamp) {
      throw new X401WalletError(
        X401WalletErrorCode.SUBMIT_FAILED,
        "OID4VP sync-HMAC response is missing X-Callback-Signature/X-Callback-Timestamp",
      );
    }
    return packageProofResponse({ payloadJson: signedResult, signature, timestamp });
  }
}
