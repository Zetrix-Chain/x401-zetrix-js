/**
 * Mock OID4VP backend for the end-to-end harness.
 *
 * Plays the role of `zetrix-oid4vp`'s sync-HMAC endpoints so the JS server (Part A) and
 * JS client (Part B) can be driven through a full round trip over a stubbed `fetch`.
 *
 * Crucially, on submit it signs the result with the SAME `callbackSecret` the resource
 * server verifies with — reusing `hmacSign` exported from `x401-zetrix-server` so the
 * signature is byte-identical to what the verifier expects. The wallet never sees the
 * secret (it only relays). If the loop verifies, interop is genuinely proven.
 */

import { hmacSign } from "x401-zetrix-server";

export interface MockOid4vpOptions {
  /** Base URL both SDKs are configured with (the mock answers everything under it). */
  baseUrl: string;
  /** Shared HMAC secret — the mock signs with it, the RS verifies with it. */
  callbackSecret: string;
  /** Override the signed timestamp (e.g. to force a stale proof). Default: now. */
  signTimestamp?: () => string;
}

type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

export function createMockOid4vp(opts: MockOid4vpOptions): { fetch: FetchImpl } {
  const { baseUrl, callbackSecret } = opts;
  const nonces = new Map<string, string>();
  let counter = 0;

  const fetchImpl: FetchImpl = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;

    // The real openid4vp-verifier-be wraps every response in ResponseWrapper<T>
    // ({ object, messages, success }); the definition uses snake_case, and the sync-HMAC
    // submit returns the signed payload in a `signed_result` field (+ X-Callback-* headers).

    // 1. RS mints a verification request -> ResponseWrapper<CreateVerificationResponseDto>.
    if (method === "POST" && path.endsWith("/v1/verification/request")) {
      counter += 1;
      const requestId = `req_e2e_${counter}`;
      const nonce = `verifier-nonce-${counter}`;
      nonces.set(requestId, nonce);
      return jsonResponse({
        object: {
          presentationId: requestId,
          nonce,
          status: "CREATED",
          expiresAt: "2026-12-31T00:00:00",
          deepLinkUrl: `zetrix://?request_uri=${baseUrl}/v1/presentation/${requestId}`,
        },
        success: true,
      });
    }

    // 2. Wallet fetches the presentation definition -> ResponseWrapper<PresentationRequestResponseDto>.
    if (method === "GET" && path.includes("/v1/presentation/") && !path.endsWith("/submit")) {
      const requestId = decodeURIComponent(path.slice(path.indexOf("/v1/presentation/") + "/v1/presentation/".length));
      return jsonResponse({
        object: {
          presentation_id: requestId,
          credential_query: { credential_type: "age_verification" },
          nonce: nonces.get(requestId) ?? `verifier-nonce-${requestId}`,
          response_uri: `${baseUrl}/v1/presentation/submit`,
          response_mode: "direct_post",
          expires_at: "2026-12-31T00:00:00",
        },
        success: true,
      });
    }

    // 3. Wallet submits the VP -> sync-HMAC signed result in `signed_result` + callback headers.
    if (method === "POST" && path.endsWith("/v1/presentation/submit")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { presentation_id?: string };
      const presentationId = body.presentation_id ?? "unknown";
      const signedResult = JSON.stringify({
        presentationId,
        verified: true,
        status: "VERIFIED",
        verifiedClaims: { age_over_18: true },
      });
      const timestamp = (opts.signTimestamp ?? (() => new Date().toISOString()))();
      // The RS recomputes HMAC over `timestamp . signed_result`.
      const signature = hmacSign(`${timestamp}.${signedResult}`, callbackSecret);
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

    return jsonResponse({ error: `unexpected ${method} ${path}` }, 404);
  };

  return { fetch: fetchImpl };
}
