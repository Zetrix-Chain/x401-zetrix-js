import { describe, expect, it } from "vitest";
import { X401Error, X401ErrorCode } from "../errors.js";

describe("X401Error", () => {
  it("sets name, code, message, and cause", () => {
    const cause = new Error("root cause");
    const err = new X401Error(X401ErrorCode.BAD_SIGNATURE, "signature mismatch", cause);

    expect(err.name).toBe("X401Error");
    expect(err.code).toBe(X401ErrorCode.BAD_SIGNATURE);
    expect(err.message).toBe("signature mismatch");
    expect(err.cause).toBe(cause);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(X401Error);
  });

  it("defaults message to the error code when none is given", () => {
    const err = new X401Error(X401ErrorCode.OID4VP_UNAVAILABLE);

    expect(err.message).toBe(X401ErrorCode.OID4VP_UNAVAILABLE);
  });

  it("survives JSON.stringify with name, code, and message intact", () => {
    const err = new X401Error(X401ErrorCode.STALE_TIMESTAMP, "timestamp too old");

    const parsed = JSON.parse(JSON.stringify(err));

    expect(parsed).toEqual({
      name: "X401Error",
      code: X401ErrorCode.STALE_TIMESTAMP,
      message: "timestamp too old",
    });
  });
});
