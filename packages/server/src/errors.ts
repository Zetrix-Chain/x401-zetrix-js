/**
 * x401 error taxonomy (Part A — server). `X401ErrorCode` is part of the LOCKED wire
 * contract (docs/08-wire-contract.md §6) and MUST stay byte-identical with the Java repo.
 */

export enum X401ErrorCode {
  OID4VP_UNAVAILABLE = "OID4VP_UNAVAILABLE",
  REQUEST_CREATE_FAILED = "REQUEST_CREATE_FAILED",
  MALFORMED_PROOF_RESPONSE = "MALFORMED_PROOF_RESPONSE",
  BAD_SIGNATURE = "BAD_SIGNATURE",
  STALE_TIMESTAMP = "STALE_TIMESTAMP",
  SESSION_MISMATCH = "SESSION_MISMATCH",
  PROOF_NOT_VERIFIED = "PROOF_NOT_VERIFIED",
}

export class X401Error extends Error {
  readonly code: X401ErrorCode;
  readonly cause?: unknown;

  constructor(code: X401ErrorCode, message?: string, cause?: unknown) {
    super(message ?? code);
    this.name = "X401Error";
    this.code = code;
    this.cause = cause;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, X401Error.prototype);
  }

  /** `message` is non-enumerable on `Error` by default — restore it for `JSON.stringify`. */
  toJSON(): { name: string; code: X401ErrorCode; message: string } {
    return { name: this.name, code: this.code, message: this.message };
  }
}
