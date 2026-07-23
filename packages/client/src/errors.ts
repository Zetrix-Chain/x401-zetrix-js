/**
 * x401 wallet error taxonomy (Part B — client). Distinct from the server-side
 * `X401ErrorCode`; see docs/08-wire-contract.md §6 and the design spec §4.6.
 */

export enum X401WalletErrorCode {
  OID4VP_UNAVAILABLE = "OID4VP_UNAVAILABLE",
  MALFORMED_PROOF_REQUEST = "MALFORMED_PROOF_REQUEST",
  DEFINITION_FETCH_FAILED = "DEFINITION_FETCH_FAILED",
  VP_BUILD_FAILED = "VP_BUILD_FAILED",
  SIGN_FAILED = "SIGN_FAILED",
  SUBMIT_FAILED = "SUBMIT_FAILED",
}

export class X401WalletError extends Error {
  readonly code: X401WalletErrorCode;
  readonly cause?: unknown;

  constructor(code: X401WalletErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.name = "X401WalletError";
    this.code = code;
    this.cause = cause;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, X401WalletError.prototype);
  }

  /** `message` is non-enumerable on `Error` by default — restore it for `JSON.stringify`. */
  toJSON(): { name: string; code: X401WalletErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}
