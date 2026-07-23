import { describe, expect, it } from "vitest";
import { renderProofResult } from "../result.js";
import type { ProofVerdict } from "../model.js";

describe("renderProofResult", () => {
  it("renders a rejected verdict to a { code, message } PROOF-RESULT error", () => {
    const verdict: ProofVerdict = {
      allowed: false,
      status: "BAD_SIGNATURE",
      errorCode: "BAD_SIGNATURE",
      errorMessage: "PROOF-RESPONSE signature does not match",
    };

    expect(renderProofResult(verdict)).toEqual({
      code: "BAD_SIGNATURE",
      message: "PROOF-RESPONSE signature does not match",
    });
  });

  it("throws when called on an allowed verdict (misuse — nothing to render)", () => {
    const verdict: ProofVerdict = { allowed: true, status: "VERIFIED" };

    expect(() => renderProofResult(verdict)).toThrow();
  });

  it("falls back to status + a default message when errorCode/errorMessage are absent", () => {
    const verdict: ProofVerdict = { allowed: false, status: "PROOF_NOT_VERIFIED" };

    expect(renderProofResult(verdict)).toEqual({
      code: "PROOF_NOT_VERIFIED",
      message: "credential presentation was not verified",
    });
  });
});
