// Service worker registration + safe update flow.
// Shows a toast when a new version is ready and reloads once the user accepts.
import { toast } from "sonner";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly background check

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) return;

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });

      // If there's already a waiting SW from a previous tab, prompt immediately.
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);

      // Watch for new SWs being installed.
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            // A new SW is installed and an old one controls the page → update available.
            promptUpdate(next);
          }
        });
      });

      // When the new SW takes control, reload once so the user is on the fresh shell.
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });

      // Periodic + visibility-driven update checks.
      const check = () => reg.update().catch(() => {});
      setInterval(check, CHECK_INTERVAL_MS);
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") check();
      });
    } catch {
      // Registration failures shouldn't break the app.
    }
  });
}

function promptUpdate(worker: ServiceWorker) {
  toast("Nova versão disponível", {
    description: "Atualize para receber as últimas melhorias do FrioSafe.",
    duration: Infinity,
    action: {
      label: "Atualizar",
      onClick: () => worker.postMessage({ type: "SKIP_WAITING" }),
    },
  });
}
