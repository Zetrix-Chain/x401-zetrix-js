/**
 * OID4VP backend client. See docs/04-api-reference-server.md §OID4VP client.
 *
 * Uses global `fetch` (Node 18+). Adds the Bearer API key; maps non-2xx →
 * X401Error(REQUEST_CREATE_FAILED), transport failure → X401Error(OID4VP_UNAVAILABLE).
 */

import type { ResolvedX401Config } from "./config.js";
import { X401Error, X401ErrorCode } from "./errors.js";
import { isNonBlankString, isRecord } from "./guards.js";
import type { CredentialRequirements, VerificationData } from "./model.js";

export interface CreateVerificationRequestOpts {
  stateId?: string;
  /**
   * Reserved for future use — NOT forwarded to the OID4VP backend. The request body's
   * frozen wire shape (docs/04-api-reference-server.md §OID4VP client:
   * `{ requirements, callbackUrl: null, stateId?, expirationMinutes }`) has no
   * `clientMetadata` field, so adding it to the request would diverge from the
   * documented, cross-repo-locked contract.
   */
  clientMetadata?: Record<string, unknown>;
}

/**
 * Map the real OID4VP `POST /v1/verification/request` response to {@link VerificationData}.
 *
 * The backend wraps every response in `ResponseWrapper<T>` (`{ object, messages, success }`)
 * and returns `CreateVerificationResponseDto` (camelCase: `presentationId`, `nonce`,
 * `expiresAt`, `deepLinkUrl`, …). `requestUri` is the wallet-facing GET-presentation URL,
 * derived from the configured base + `presentationId`.
 */
function mapVerificationData(body: unknown, baseUrl: string): VerificationData {
  const obj = isRecord(body) ? body.object : undefined;
  if (
    !isRecord(obj) ||
    !isNonBlankString(obj.presentationId) ||
    !isNonBlankString(obj.nonce) ||
    !isNonBlankString(obj.expiresAt)
  ) {
    throw new X401Error(
      X401ErrorCode.REQUEST_CREATE_FAILED,
      "OID4VP backend returned a malformed verification response",
    );
  }
  return {
    requestId: obj.presentationId,
    requestUri: `${baseUrl}/v1/presentation/${encodeURIComponent(obj.presentationId)}`,
    nonce: obj.nonce,
    expiresAt: obj.expiresAt,
  };
}

export class Oid4vpClient {
  private readonly cfg: ResolvedX401Config;

  constructor(cfg: ResolvedX401Config) {
    this.cfg = cfg;
  }

  /**
   * `POST /v1/verification/request` — Bearer API key, `callbackUrl: null` → sync-HMAC mode.
   */
  async createVerificationRequest(
    req: CredentialRequirements,
    opts?: CreateVerificationRequestOpts,
  ): Promise<VerificationData> {
    let response: Response;
    try {
      response = await fetch(`${this.cfg.oid4vpBaseUrl}/v1/verification/request`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requirements: req,
          callbackUrl: null,
          stateId: opts?.stateId,
          expirationMinutes: this.cfg.expirationMinutes,
        }),
        // Node's global fetch has no default timeout — bound it so a hung
        // backend surfaces as OID4VP_UNAVAILABLE (via the catch below).
        signal: AbortSignal.timeout(this.cfg.oid4vpTimeoutMs),
      });
    } catch (cause) {
      throw new X401Error(X401ErrorCode.OID4VP_UNAVAILABLE, "OID4VP backend unreachable", cause);
    }

    if (!response.ok) {
      throw new X401Error(
        X401ErrorCode.REQUEST_CREATE_FAILED,
        `OID4VP backend returned ${response.status}`,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      throw new X401Error(
        X401ErrorCode.REQUEST_CREATE_FAILED,
        "OID4VP backend returned a non-JSON response",
        cause,
      );
    }
    return mapVerificationData(body, this.cfg.oid4vpBaseUrl);
  }
}
