/**
 * Injected dependencies (Part B — client).
 *
 * The wallet SDK performs orchestration, not heavy crypto. Both interfaces are implemented
 * by the consumer (e.g. the agentic-wallet-mcp):
 *   - `HolderSigner`   — over Wallet BE → softHSM (interface stable for HSM cutover).
 *   - `VcProofProvider`— over the ZID/VC MCP `vp_create`.
 * The SDK never touches a raw key. See docs/06-configuration.md.
 */

/** Holder-binding signer — signs over the verifier nonce. */
export interface HolderSigner {
  sign(nonce: string): Promise<{ signBlob: string; publicKey: string }>;
}

/**
 * Produces the wallet-auth headers the OID4VP `POST /v1/presentation/submit` endpoint
 * requires (`X-Wallet-Public-Key` + `X-Wallet-Signed-Data`). The backend's
 * `WalletAuthenticationFilter` derives the wallet address from `publicKey` and verifies
 * `signedData` is an Ed25519 signature over that address — i.e. the holder signs their own
 * Zetrix address. Optional: when omitted, no auth headers are sent (for backends/tests that
 * do not require them).
 */
export type SubmitAuthProvider = () => Promise<{ publicKey: string; signedData: string }>;

/** VC proof provider — delegates VP derivation to the ZID/VC MCP `vp_create`. */
export interface VcProofProvider {
  createVp(input: {
    credentialQuery: unknown;
    nonce: string;
    holderDid: string;
  }): Promise<{
    vp: unknown;
    ed25519PublicKey: string;
    bbsPublicKey: string;
    /**
     * DIF Presentation-Exchange submission mapping the VP to the presentation definition
     * (`{ id, definition_id, descriptor_map }`). The OID4VP backend requires it on submit
     * (`SubmitPresentationReqDto.presentation_submission` is `@NotNull`). Produced by
     * `vp_create` alongside the VP, since it owns the `descriptor_map` paths.
     */
    presentationSubmission: Record<string, unknown>;
  }>;
}
