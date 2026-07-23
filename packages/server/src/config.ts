/**
 * x401 SDK configuration.
 *
 * Secrets (`apiKey`, `callbackSecret`) come from env / secret manager — never hard-code.
 * See docs/06-configuration.md.
 */

/**
 * Known Zetrix networks → their OID4VP verifier base URL. Selecting a `network` on the
 * config resolves `oid4vpBaseUrl` from this map; an explicit `oid4vpBaseUrl` still wins.
 */
export const ZETRIX_OID4VP_URLS = {
  "zetrix:testnet": "https://zid-oid4vp-sandbox.zetrix.com/api",
  "zetrix:mainnet": "https://zid-oid4vp.zetrix.com/api",
} as const;

/** A supported Zetrix network identifier. */
export type ZetrixNetwork = keyof typeof ZETRIX_OID4VP_URLS;

export interface X401Config {
  /**
   * REQUIRED unless `network` is set — OID4VP backend base URL,
   * e.g. https://zid-oid4vp-sandbox.zetrix.com/api. Overrides `network` when both are given.
   */
  oid4vpBaseUrl?: string;
  /**
   * optional — a Zetrix network whose default OID4VP base URL is used when `oid4vpBaseUrl`
   * is not given: `zetrix:testnet` → sandbox, `zetrix:mainnet` → production.
   */
  network?: ZetrixNetwork;
  /** REQUIRED — Bearer `ztx_...` API key that authenticates request creation */
  apiKey: string;
  /** REQUIRED — shared HMAC secret used to verify the `PROOF-RESPONSE` */
  callbackSecret: string;
  /** optional — max age of the `PROOF-RESPONSE` timestamp in seconds (default 300) */
  proofResponseTtlSec?: number;
  /** optional — OID4VP backend request timeout in milliseconds (default 30000) */
  oid4vpTimeoutMs?: number;
  /** optional — verification-request TTL in minutes (default: backend default) */
  expirationMinutes?: number;
  /** optional — challenge header name (default "PROOF-REQUEST") */
  proofRequestHeader?: string;
  /** optional — result header name (default "PROOF-RESPONSE") */
  proofResponseHeader?: string;
}

export const DEFAULT_PROOF_REQUEST_HEADER = "PROOF-REQUEST";
export const DEFAULT_PROOF_RESPONSE_HEADER = "PROOF-RESPONSE";
export const DEFAULT_PROOF_RESPONSE_TTL_SEC = 300;
export const DEFAULT_OID4VP_TIMEOUT_MS = 30000;

/**
 * {@link X401Config} with defaults applied. `expirationMinutes` has no default (backend
 * default applies), so it stays optional. `network` is resolved into `oid4vpBaseUrl` and
 * dropped, so it never appears on the resolved config.
 */
export type ResolvedX401Config = Omit<
  Required<X401Config>,
  "expirationMinutes" | "network"
> &
  Pick<X401Config, "expirationMinutes">;

function requireNonBlank(value: string | undefined, field: string): string {
  if (!value || value.trim() === "") {
    throw new Error(`x401 config: "${field}" is required and must not be blank`);
  }
  return value;
}

function resolvePositiveNumber(value: number | undefined, field: string, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`x401 config: "${field}" must be a finite positive number`);
  }
  return value;
}

/**
 * Resolve the OID4VP base URL: an explicit `oid4vpBaseUrl` wins; otherwise derive it from
 * `network`. Throws if neither is usable or `network` is not a known Zetrix network.
 */
function resolveOid4vpBaseUrl(cfg: Pick<X401Config, "oid4vpBaseUrl" | "network">): string {
  if (cfg.oid4vpBaseUrl && cfg.oid4vpBaseUrl.trim() !== "") {
    return cfg.oid4vpBaseUrl;
  }
  if (cfg.network !== undefined) {
    // Own-property check: a bracket lookup like ZETRIX_OID4VP_URLS["__proto__"] / ["toString"]
    // would otherwise return an inherited value and slip past an `=== undefined` guard.
    if (!Object.prototype.hasOwnProperty.call(ZETRIX_OID4VP_URLS, cfg.network)) {
      throw new Error(
        `x401 config: "network" must be one of ${Object.keys(ZETRIX_OID4VP_URLS).join(", ")}`,
      );
    }
    return ZETRIX_OID4VP_URLS[cfg.network];
  }
  throw new Error('x401 config: provide "network" or a non-blank "oid4vpBaseUrl"');
}

/**
 * Validate and normalise an {@link X401Config}, applying defaults.
 *
 * Throws if `apiKey` or `callbackSecret` is missing/blank, or if neither `oid4vpBaseUrl`
 * nor a valid `network` is provided.
 */
export function defineConfig(cfg: X401Config): ResolvedX401Config {
  return {
    oid4vpBaseUrl: resolveOid4vpBaseUrl(cfg),
    apiKey: requireNonBlank(cfg.apiKey, "apiKey"),
    callbackSecret: requireNonBlank(cfg.callbackSecret, "callbackSecret"),
    proofResponseTtlSec: resolvePositiveNumber(
      cfg.proofResponseTtlSec,
      "proofResponseTtlSec",
      DEFAULT_PROOF_RESPONSE_TTL_SEC,
    ),
    oid4vpTimeoutMs: resolvePositiveNumber(
      cfg.oid4vpTimeoutMs,
      "oid4vpTimeoutMs",
      DEFAULT_OID4VP_TIMEOUT_MS,
    ),
    expirationMinutes: cfg.expirationMinutes,
    proofRequestHeader: cfg.proofRequestHeader ?? DEFAULT_PROOF_REQUEST_HEADER,
    proofResponseHeader: cfg.proofResponseHeader ?? DEFAULT_PROOF_RESPONSE_HEADER,
  };
}
