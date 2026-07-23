/**
 * Example x401 resource server (Express) using `x401-zetrix-server`.
 *
 * The x401 proof is a one-shot handshake: prove once at POST /x401/session, the server
 * issues a session token, and later requests to GET /protected authorize with that session
 * (not a re-presented proof — each PROOF-RESPONSE is single-use under the replay guard).
 *
 * Copy .env.example to .env and fill in the values, then:  pnpm dev
 */

import "dotenv/config";
import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  X401Verifier,
  requireProof,
  InMemoryReplayGuard,
  DEFAULT_PROOF_RESPONSE_TTL_SEC,
  type CredentialRequirements,
  type ZetrixNetwork,
} from "x401-zetrix-server";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const verifier = new X401Verifier(
  {
    // Pick a network (derives the OID4VP URL) or pin X401_OID4VP_BASE_URL explicitly.
    network: process.env.X401_NETWORK as ZetrixNetwork | undefined,
    oid4vpBaseUrl: process.env.X401_OID4VP_BASE_URL,
    apiKey: requireEnv("X401_API_KEY"),
    callbackSecret: requireEnv("X401_CALLBACK_SECRET"),
  },
  {
    // Opt-in: reject a PROOF-RESPONSE replayed within its freshness window.
    replayGuard: new InMemoryReplayGuard(DEFAULT_PROOF_RESPONSE_TTL_SEC * 1000),
    // Opt-in audit trail — receives no secrets or claims.
    onVerify: (event) => console.info("[x401 audit]", JSON.stringify(event)),
  },
);

const requirements: CredentialRequirements = {
  credential_type: "age_verification",
  claims: ["age_over_18"],
};

// Demo session store — use a signed cookie / JWT + a shared store in production.
const sessions = new Set<string>();

const app = express();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Prove once → exchange the verified proof for a session token.
app.post(
  "/x401/session",
  requireProof(verifier, requirements) as unknown as express.RequestHandler,
  (req: Request, res: Response) => {
    const token = randomUUID();
    sessions.add(token);
    res.json({ session: token, claims: (req as { x401Claims?: unknown }).x401Claims });
  },
);

// Subsequent requests authorize with the session — not a re-presented proof.
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

// Error handler — log the real error server-side, return a generic body to callers so
// upstream failures (e.g. an unreachable OID4VP backend) never leak stack traces / file paths.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[x401 resource server] unhandled error:", err);
  res.status(500).json({ error: "internal error" });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.info(`x401 example resource server listening on http://localhost:${port}`);
});
