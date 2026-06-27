// Pure helpers for the kiosk "atualizado há Ns" computation.
// Kept isolated from React so they can be unit-tested deterministically.

/**
 * Calculate the offset (in ms) between server clock and client clock.
 * `offset = serverTime - clientTime`. Apply by `serverNow = clientNow + offset`.
 */
export function computeOffsetMs(serverTimeIso: string, clientNowMs: number): number {
  const serverMs = new Date(serverTimeIso).getTime();
  if (!Number.isFinite(serverMs)) return 0;
  return serverMs - clientNowMs;
}

/**
 * Seconds since the last successful poll, expressed in *server* time.
 * Returns 0 when no successful poll has happened yet, and never goes negative.
 * During network failures the client clock keeps ticking, so the value grows
 * monotonically until the next successful poll resets `lastServerTimeMs`.
 */
export function ageSeconds(
  lastServerTimeMs: number | null,
  clientNowMs: number,
  offsetMs: number,
): number {
  if (lastServerTimeMs == null) return 0;
  const serverNow = clientNowMs + offsetMs;
  const diffMs = serverNow - lastServerTimeMs;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 0;
  return Math.floor(diffMs / 1000);
}

/**
 * Format the age label exactly as shown in the kiosk footer.
 */
export function ageLabel(seconds: number): string {
  return `atualizado há ${seconds}s`;
}
