import { describe, expect, it } from "vitest";
import { X401WalletError, X401WalletErrorCode } from "../errors.js";

describe("X401WalletError", () => {
  it("sets name, code, message, and cause", () => {
    const cause = new Error("root cause");
    const err = new X401WalletError(X401WalletErrorCode.SUBMIT_FAILED, "submit failed", cause);

    expect(err.name).toBe("X401WalletError");
    expect(err.code).toBe(X401WalletErrorCode.SUBMIT_FAILED);
    expect(err.message).toBe("submit failed");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(X401WalletError);
  });

  it("defaults message to the error code when none is given", () => {
    const err = new X401WalletError(X401WalletErrorCode.OID4VP_UNAVAILABLE);

    expect(err.message).toBe(X401WalletErrorCode.OID4VP_UNAVAILABLE);
  });

  it("survives JSON.stringify with name, code, and message intact", () => {
    const err = new X401WalletError(X401WalletErrorCode.SUBMIT_FAILED, "submit failed");

    expect(JSON.parse(JSON.stringify(err))).toEqual({
      name: "X401WalletError",
      code: X401WalletErrorCode.SUBMIT_FAILED,
      message: "submit failed",
    });
  });
});
