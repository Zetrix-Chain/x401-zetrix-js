/** Resource-server side of the e2e harness — a real X401Verifier. */

import { X401Verifier, type ReplayGuard } from "x401-zetrix-server";

export function makeResourceServer(
  cfg: { oid4vpBaseUrl: string; apiKey: string; callbackSecret: string },
  opts?: { replayGuard?: ReplayGuard },
): X401Verifier {
  return new X401Verifier(cfg, opts);
}
