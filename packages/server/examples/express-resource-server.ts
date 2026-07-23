/**
 * Sample x401 resource server (Express).
 *
 *   npm install express
 *   export X401_OID4VP_BASE_URL="https://zid-oid4vp-sandbox.zetrix.com/api"
 *   export X401_API_KEY="ztx_..."
 *   export X401_CALLBACK_SECRET="<shared HMAC secret>"
 *   npx tsx examples/express-resource-server.ts
 *
 * Flow — the x401 proof is a ONE-SHOT handshake, not a per-request credential:
 *   1. POST /x401/session            -> 401 + PROOF-REQUEST header
 *   2. wallet answers; agent retries POST /x401/session with the PROOF-RESPONSE header
 *      -> 200 { session } (the proof verified; the RS issues its own session token)
 *   3. GET /protected  (Authorization: Bearer <session>)  -> 200
 *
 * Why a session hand-off? The replay guard makes each PROOF-RESPONSE single-use (a captured
 * one can't be replayed within its freshness window). So gating a *persistent* route with
 * `requireProof` directly would reject the caller's second request. Instead: prove once,
 * exchange the proof for a normal session (cookie/JWT), and authorize later requests with
 * that session.
 *
 * This example imports from the published package name. Inside this repo, replace
 * "x401-zetrix-server" with "../src/index" to run against the local source.
 */

import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  X401Verifier,
  requireProof,
  InMemoryReplayGuard,
  DEFAULT_PROOF_RESPONSE_TTL_SEC,
  type CredentialRequirements,
} from "x401-zetrix-server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Secrets come from the environment — never hard-code them (see docs/06-configuration.md).
const verifier = new X401Verifier(
  {
    oid4vpBaseUrl: requireEnv("X401_OID4VP_BASE_URL"),
    apiKey: requireEnv("X401_API_KEY"),
    callbackSecret: requireEnv("X401_CALLBACK_SECRET"),
  },
  {
    // Opt-in hardening: reject a PROOF-RESPONSE replayed within its freshness window.
    // In-memory is process-local — use a shared store for a cluster.
    replayGuard: new InMemoryReplayGuard(DEFAULT_PROOF_RESPONSE_TTL_SEC * 1000),
    // Opt-in audit trail — receives no secrets or claims.
    onVerify: (event) => console.info("[x401 audit]", JSON.stringify(event)),
  },
);

// What the caller must prove — echoed into the PROOF-REQUEST.
const requirements: CredentialRequirements = {
  credential_type: "age_verification",
  claims: ["age_over_18"],
};

// Demo session store. Use a real signed cookie / JWT + a shared store in production.
const sessions = new Set<string>();

const app = express();

// 1-2. Prove once, then exchange the verified proof for a session token.
app.post(
  "/x401/session",
  requireProof(verifier, requirements),
  (req: Request, res: Response) => {
    const token = randomUUID();
    sessions.add(token);
    res.json({ session: token, claims: (req as { x401Claims?: unknown }).x401Claims });
  },
);

// 3. Subsequent requests authorize with the session — NOT a re-presented proof.
function requireSession(req: Request, res: Response, next: NextFunction): void {
  const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (!token || !sessions.has(token)) {
    res.status(401).json({ error: "no valid session — obtain one at POST /x401/session" });
    return;
  }
  next();
}

app.get("/protected", requireSession, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.info(`x401 sample resource server listening on http://localhost:${port}`);
});
