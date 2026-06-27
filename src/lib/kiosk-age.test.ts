import { describe, it, expect } from "vitest";
import { computeOffsetMs, ageSeconds, ageLabel } from "./kiosk-age";

describe("computeOffsetMs", () => {
  it("returns positive offset when server clock is ahead of client", () => {
    const offset = computeOffsetMs("2026-06-27T12:00:05.000Z", Date.parse("2026-06-27T12:00:00.000Z"));
    expect(offset).toBe(5_000);
  });

  it("returns negative offset when client clock is ahead of server", () => {
    const offset = computeOffsetMs("2026-06-27T12:00:00.000Z", Date.parse("2026-06-27T12:00:03.000Z"));
    expect(offset).toBe(-3_000);
  });

  it("returns 0 when server_time is invalid", () => {
    expect(computeOffsetMs("not-a-date", 1_000)).toBe(0);
  });
});

describe("ageSeconds", () => {
  it("returns 0 when no successful poll has happened yet", () => {
    expect(ageSeconds(null, Date.now(), 0)).toBe(0);
  });

  it("computes age relative to server clock, not client clock", () => {
    // Client clock drifted 10s ahead of server; offset corrects for it.
    const serverNow = Date.parse("2026-06-27T12:00:00.000Z");
    const clientNow = serverNow + 10_000; // client thinks it's 12:00:10
    const offset = -10_000; // server - client
    const lastServer = serverNow - 7_000; // last poll succeeded 7 server-seconds ago
    expect(ageSeconds(lastServer, clientNow, offset)).toBe(7);
  });

  it("never returns negative when last poll is in the future (clock skew)", () => {
    const clientNow = Date.parse("2026-06-27T12:00:00.000Z");
    const lastServer = clientNow + 5_000; // future
    expect(ageSeconds(lastServer, clientNow, 0)).toBe(0);
  });

  it("grows monotonically during a network outage, then resets on recovery", () => {
    // Simulate the full transition the kiosk goes through.
    const startServer = Date.parse("2026-06-27T12:00:00.000Z");
    const startClient = startServer; // assume aligned at boot
    let offset = computeOffsetMs("2026-06-27T12:00:00.000Z", startClient);
    let lastServer: number | null = startServer;

    // t+20s — last poll was 20s ago, outage just starting.
    expect(ageSeconds(lastServer, startClient + 20_000, offset)).toBe(20);
    // t+40s — outage continues, no successful poll, label keeps growing.
    expect(ageSeconds(lastServer, startClient + 40_000, offset)).toBe(40);
    // t+90s — still down, age keeps climbing.
    expect(ageSeconds(lastServer, startClient + 90_000, offset)).toBe(90);

    // Network recovers at t+95s: server says it is 12:01:35 (server jumped during outage).
    const recoveryClient = startClient + 95_000;
    const recoveryServerIso = "2026-06-27T12:01:35.000Z";
    offset = computeOffsetMs(recoveryServerIso, recoveryClient);
    lastServer = Date.parse(recoveryServerIso);

    // Immediately after recovery the label resets to 0.
    expect(ageSeconds(lastServer, recoveryClient, offset)).toBe(0);
    // 3s later it reads 3s, regardless of how long the outage lasted.
    expect(ageSeconds(lastServer, recoveryClient + 3_000, offset)).toBe(3);
  });
});

describe("ageLabel", () => {
  it("matches the kiosk footer format", () => {
    expect(ageLabel(0)).toBe("atualizado há 0s");
    expect(ageLabel(42)).toBe("atualizado há 42s");
  });
});
