/**
 * `PROOF-REQUEST` challenge builder. See docs/08-wire-contract.md §2.
 */

import { DEFAULT_PROOF_REQUEST_HEADER } from "./config.js";
import type {
  CredentialRequirements,
  Http401Like,
  ProofRequest,
  ProofRequestBody,
  VerificationData,
} from "./model.js";

/**
 * Build the `PROOF-REQUEST` challenge from the OID4VP `VerificationData` and the
 * echoed `CredentialRequirements`. The result exposes `headerValue`
 * (base64url(UTF-8 JSON)), the JSON `body`, and `toHttp401()`.
 */
export function buildProofChallenge(
  vd: VerificationData,
  req: CredentialRequirements,
  proofRequestHeader: string = DEFAULT_PROOF_REQUEST_HEADER,
): ProofRequest {
  const body: ProofRequestBody = {
    verification_data: {
      requestUri: vd.requestUri,
      nonce: vd.nonce,
      expiresAt: vd.expiresAt,
    },
    credential_requirements: req,
    request_id: vd.requestId,
    nonce: vd.nonce,
    request_uri: vd.requestUri,
  };
  const headerValue = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");

  return {
    headerValue,
    body,
    toHttp401(): Http401Like {
      return {
        status: 401,
        headers: { [proofRequestHeader]: headerValue },
        body,
      };
    },
  };
}
