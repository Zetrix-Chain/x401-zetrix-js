/**
 * Replay guard — reject a `request_id` (presentationId) that has already been
 * accepted, so a captured `PROOF-RESPONSE` cannot be re-submitted within its
 * freshness window. See docs/04-api-reference-server.md.
 *
 * The guard is OPT-IN: an `X401Verifier` only enforces it when one is supplied.
 * The default {@link InMemoryReplayGuard} is process-local — for multi-instance
 * deployments supply a shared (e.g. Redis-backed) implementation of this interface.
 */

export interface ReplayGuard {
  /**
   * Record `requestId` as used. Returns `true` if it was fresh (not seen before),
   * `false` if it has already been consumed (a replay).
   */
  checkAndRemember(requestId: string): boolean;
}

/**
 * Process-local {@link ReplayGuard} that remembers each `request_id` until its TTL
 * elapses. Entries older than `ttlMs` are purged on access — a proof past its freshness
 * window is rejected by the verifier anyway, so the entry is safe to forget.
 *
 * Set `ttlMs` to at least the verifier's freshness window (`proofResponseTtlSec * 1000`,
 * plus any receipt latency); a shorter guard TTL would forget a proof while it is still
 * fresh, re-opening the replay gap the guard is meant to close.
 */
export class InMemoryReplayGuard implements ReplayGuard {
  private readonly ttlMs: number;
  private readonly seen = new Map<string, number>();
  private lastPurge = 0;

  constructor(ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("InMemoryReplayGuard: ttlMs must be a finite positive number");
    }
    this.ttlMs = ttlMs;
  }

  checkAndRemember(requestId: string): boolean {
    const now = Date.now();
    const expiry = this.seen.get(requestId);
    // `>=` mirrors the verifier's freshness check (`<=`): while a proof can still be
    // fresh at exactly the boundary, its request_id must still count as already used.
    if (expiry !== undefined && expiry >= now) {
      return false;
    }
    this.maybePurge(now);
    this.seen.set(requestId, now + this.ttlMs);
    return true;
  }

  /** Sweep expired entries at most once per TTL window — O(n) amortised to O(1) per call. */
  private maybePurge(now: number): void {
    if (now - this.lastPurge < this.ttlMs) {
      return;
    }
    this.lastPurge = now;
    for (const [id, expiry] of this.seen) {
      if (expiry < now) {
        this.seen.delete(id);
      }
    }
  }
}
