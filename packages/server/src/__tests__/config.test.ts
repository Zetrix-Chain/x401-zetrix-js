import { describe, expect, it } from "vitest";
import {
  DEFAULT_OID4VP_TIMEOUT_MS,
  DEFAULT_PROOF_REQUEST_HEADER,
  DEFAULT_PROOF_RESPONSE_HEADER,
  DEFAULT_PROOF_RESPONSE_TTL_SEC,
  ZETRIX_OID4VP_URLS,
  defineConfig,
  type X401Config,
} from "../config.js";

const validConfig: X401Config = {
  oid4vpBaseUrl: "https://zid-oid4vp-sandbox.zetrix.com/api",
  apiKey: "ztx_test_key",
  callbackSecret: "shared-secret",
};

/** Secrets only — no oid4vpBaseUrl, no network. */
const secretsOnly = { apiKey: "ztx_test_key", callbackSecret: "shared-secret" };

describe("defineConfig", () => {
  it("throws when oid4vpBaseUrl is missing", () => {
    const { oid4vpBaseUrl, ...rest } = validConfig;
    expect(() => defineConfig(rest as X401Config)).toThrow();
  });

  it("throws when oid4vpBaseUrl is blank", () => {
    expect(() => defineConfig({ ...validConfig, oid4vpBaseUrl: "   " })).toThrow();
  });

  it("throws when apiKey is missing", () => {
    const { apiKey, ...rest } = validConfig;
    expect(() => defineConfig(rest as X401Config)).toThrow();
  });

  it("throws when apiKey is blank", () => {
    expect(() => defineConfig({ ...validConfig, apiKey: "" })).toThrow();
  });

  it("throws when callbackSecret is missing", () => {
    const { callbackSecret, ...rest } = validConfig;
    expect(() => defineConfig(rest as X401Config)).toThrow();
  });

  it("throws when callbackSecret is blank", () => {
    expect(() => defineConfig({ ...validConfig, callbackSecret: "" })).toThrow();
  });

  it("throws when proofResponseTtlSec is NaN", () => {
    expect(() => defineConfig({ ...validConfig, proofResponseTtlSec: NaN })).toThrow();
  });

  it("throws when proofResponseTtlSec is zero or negative", () => {
    expect(() => defineConfig({ ...validConfig, proofResponseTtlSec: 0 })).toThrow();
    expect(() => defineConfig({ ...validConfig, proofResponseTtlSec: -60 })).toThrow();
  });

  it("throws when oid4vpTimeoutMs is NaN, zero, or negative", () => {
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: NaN })).toThrow();
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: 0 })).toThrow();
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: -1000 })).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const result = defineConfig(validConfig);
    expect(result.proofResponseTtlSec).toBe(DEFAULT_PROOF_RESPONSE_TTL_SEC);
    expect(result.oid4vpTimeoutMs).toBe(DEFAULT_OID4VP_TIMEOUT_MS);
    expect(result.proofRequestHeader).toBe(DEFAULT_PROOF_REQUEST_HEADER);
    expect(result.proofResponseHeader).toBe(DEFAULT_PROOF_RESPONSE_HEADER);
    expect(result.expirationMinutes).toBeUndefined();
  });

  it("passes valid config through, preserving explicit overrides", () => {
    const result = defineConfig({
      ...validConfig,
      proofResponseTtlSec: 120,
      oid4vpTimeoutMs: 5000,
      expirationMinutes: 10,
      proofRequestHeader: "X-Custom-Request",
      proofResponseHeader: "X-Custom-Response",
    });
    expect(result).toEqual({
      oid4vpBaseUrl: validConfig.oid4vpBaseUrl,
      apiKey: validConfig.apiKey,
      callbackSecret: validConfig.callbackSecret,
      proofResponseTtlSec: 120,
      oid4vpTimeoutMs: 5000,
      expirationMinutes: 10,
      proofRequestHeader: "X-Custom-Request",
      proofResponseHeader: "X-Custom-Response",
    });
  });
});

describe("defineConfig — network resolution", () => {
  it("exposes the Zetrix network → OID4VP URL map", () => {
    expect(ZETRIX_OID4VP_URLS).toEqual({
      "zetrix:testnet": "https://zid-oid4vp-sandbox.zetrix.com/api",
      "zetrix:mainnet": "https://zid-oid4vp.zetrix.com/api",
    });
  });

  it("derives oid4vpBaseUrl from network=zetrix:testnet when no explicit URL is given", () => {
    const result = defineConfig({ ...secretsOnly, network: "zetrix:testnet" });
    expect(result.oid4vpBaseUrl).toBe("https://zid-oid4vp-sandbox.zetrix.com/api");
  });

  it("derives oid4vpBaseUrl from network=zetrix:mainnet when no explicit URL is given", () => {
    const result = defineConfig({ ...secretsOnly, network: "zetrix:mainnet" });
    expect(result.oid4vpBaseUrl).toBe("https://zid-oid4vp.zetrix.com/api");
  });

  it("lets an explicit oid4vpBaseUrl override network", () => {
    const result = defineConfig({
      ...secretsOnly,
      network: "zetrix:mainnet",
      oid4vpBaseUrl: "https://custom.example/api",
    });
    expect(result.oid4vpBaseUrl).toBe("https://custom.example/api");
  });

  it("throws when neither network nor oid4vpBaseUrl is provided", () => {
    expect(() => defineConfig(secretsOnly as X401Config)).toThrow();
  });

  it("throws on an unknown network value", () => {
    expect(() =>
      defineConfig({ ...secretsOnly, network: "zetrix:devnet" as never }),
    ).toThrow();
  });

  it("throws on an inherited-property key (e.g. __proto__) instead of resolving it", () => {
    expect(() =>
      defineConfig({ ...secretsOnly, network: "__proto__" as never }),
    ).toThrow();
    expect(() =>
      defineConfig({ ...secretsOnly, network: "toString" as never }),
    ).toThrow();
  });

  it("does not leak a `network` field into the resolved config", () => {
    const result = defineConfig({ ...secretsOnly, network: "zetrix:testnet" });
    expect("network" in result).toBe(false);
  });
});
