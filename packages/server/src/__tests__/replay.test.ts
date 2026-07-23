import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryReplayGuard } from "../replay.js";

describe("InMemoryReplayGuard", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects a non-positive or non-finite ttl at construction", () => {
    expect(() => new InMemoryReplayGuard(0)).toThrow();
    expect(() => new InMemoryReplayGuard(-1)).toThrow();
    expect(() => new InMemoryReplayGuard(Number.NaN)).toThrow();
  });

  it("accepts a request_id the first time and rejects it on reuse", () => {
    const guard = new InMemoryReplayGuard(300_000);

    expect(guard.checkAndRemember("req_abc123")).toBe(true);
    expect(guard.checkAndRemember("req_abc123")).toBe(false);
  });

  it("still rejects a replay at exactly the TTL boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-23T10:00:00Z"));
    const guard = new InMemoryReplayGuard(300_000);

    expect(guard.checkAndRemember("req_abc123")).toBe(true);
    vi.advanceTimersByTime(300_000); // now === expiry
    expect(guard.checkAndRemember("req_abc123")).toBe(false);
  });

  it("treats distinct request_ids independently", () => {
    const guard = new InMemoryReplayGuard(300_000);

    expect(guard.checkAndRemember("req_a")).toBe(true);
    expect(guard.checkAndRemember("req_b")).toBe(true);
  });

  it("forgets a request_id after its TTL elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-23T10:00:00Z"));
    const guard = new InMemoryReplayGuard(300_000);

    expect(guard.checkAndRemember("req_abc123")).toBe(true);
    vi.advanceTimersByTime(300_001);
    // TTL elapsed → the id is forgotten and accepted again
    expect(guard.checkAndRemember("req_abc123")).toBe(true);
  });
});
