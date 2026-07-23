import { describe, expect, it } from "vitest";
import {
  DEFAULT_OID4VP_TIMEOUT_MS,
  DEFAULT_PROOF_REQUEST_HEADER,
  DEFAULT_PROOF_RESPONSE_HEADER,
  ZETRIX_OID4VP_URLS,
  defineConfig,
  type X401WalletConfig,
} from "../config.js";

const validConfig: X401WalletConfig = {
  oid4vpBaseUrl: "https://zid-oid4vp-sandbox.zetrix.com/api",
};

describe("defineConfig", () => {
  it("throws when oid4vpBaseUrl is missing", () => {
    expect(() => defineConfig({} as X401WalletConfig)).toThrow();
  });

  it("throws when oid4vpBaseUrl is blank", () => {
    expect(() => defineConfig({ oid4vpBaseUrl: "   " })).toThrow();
  });

  it("throws when oid4vpTimeoutMs is NaN, zero, or negative", () => {
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: NaN })).toThrow();
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: 0 })).toThrow();
    expect(() => defineConfig({ ...validConfig, oid4vpTimeoutMs: -1000 })).toThrow();
  });

  it("applies defaults for optional fields", () => {
    const result = defineConfig(validConfig);

    expect(result.proofRequestHeader).toBe(DEFAULT_PROOF_REQUEST_HEADER);
    expect(result.proofResponseHeader).toBe(DEFAULT_PROOF_RESPONSE_HEADER);
    expect(result.oid4vpTimeoutMs).toBe(DEFAULT_OID4VP_TIMEOUT_MS);
  });

  it("passes valid config through, preserving explicit overrides", () => {
    const result = defineConfig({
      oid4vpBaseUrl: validConfig.oid4vpBaseUrl,
      proofRequestHeader: "X-Custom-Request",
      proofResponseHeader: "X-Custom-Response",
      oid4vpTimeoutMs: 5000,
    });

    expect(result).toEqual({
      oid4vpBaseUrl: validConfig.oid4vpBaseUrl,
      proofRequestHeader: "X-Custom-Request",
      proofResponseHeader: "X-Custom-Response",
      oid4vpTimeoutMs: 5000,
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

  it("derives oid4vpBaseUrl from network=zetrix:testnet", () => {
    const result = defineConfig({ network: "zetrix:testnet" });
    expect(result.oid4vpBaseUrl).toBe("https://zid-oid4vp-sandbox.zetrix.com/api");
  });

  it("derives oid4vpBaseUrl from network=zetrix:mainnet", () => {
    const result = defineConfig({ network: "zetrix:mainnet" });
    expect(result.oid4vpBaseUrl).toBe("https://zid-oid4vp.zetrix.com/api");
  });

  it("lets an explicit oid4vpBaseUrl override network", () => {
    const result = defineConfig({
      network: "zetrix:mainnet",
      oid4vpBaseUrl: "https://custom.example/api",
    });
    expect(result.oid4vpBaseUrl).toBe("https://custom.example/api");
  });

  it("throws when neither network nor oid4vpBaseUrl is provided", () => {
    expect(() => defineConfig({} as X401WalletConfig)).toThrow();
  });

  it("throws on an unknown network value", () => {
    expect(() => defineConfig({ network: "zetrix:devnet" as never })).toThrow();
  });

  it("throws on an inherited-property key (e.g. __proto__) instead of resolving it", () => {
    expect(() => defineConfig({ network: "__proto__" as never })).toThrow();
    expect(() => defineConfig({ network: "toString" as never })).toThrow();
  });

  it("does not leak a `network` field into the resolved config", () => {
    const result = defineConfig({ network: "zetrix:testnet" });
    expect("network" in result).toBe(false);
  });
});
