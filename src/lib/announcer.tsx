import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Politeness = "polite" | "assertive";
type Announce = (message: string, politeness?: Politeness) => void;

const AnnouncerContext = createContext<Announce | null>(null);

/**
 * Provides a screen-reader-only live region used to announce the result of
 * asynchronous actions (success/error) without relying on color alone.
 * Two regions are rendered (polite + assertive) per WAI-ARIA guidance.
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMsg, setPoliteMsg] = useState("");
  const [assertiveMsg, setAssertiveMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback<Announce>((message, politeness = "polite") => {
    // Reset then set so identical consecutive messages are still re-announced.
    if (politeness === "assertive") {
      setAssertiveMsg("");
      requestAnimationFrame(() => setAssertiveMsg(message));
    } else {
      setPoliteMsg("");
      requestAnimationFrame(() => setPoliteMsg(message));
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setPoliteMsg("");
      setAssertiveMsg("");
    }, 6000);
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">{politeMsg}</div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">{assertiveMsg}</div>
    </AnnouncerContext.Provider>
  );
}

/**
 * Returns the announce function. Safe to call outside a provider —
 * falls back to a no-op so callers don't need to guard.
 */
export function useAnnouncer(): Announce {
  const ctx = useContext(AnnouncerContext);
  return ctx ?? ((_m: string) => { /* no-op when provider is absent */ });
}
