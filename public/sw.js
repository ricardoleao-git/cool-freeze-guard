// FrioSafe service worker — versioned cache + network-first with safe update flow.
// Bump SW_VERSION on every deploy to invalidate the offline shell.
const SW_VERSION = "2026-05-28-2";
const CACHE = `friosafe-${SW_VERSION}`;
const SHELL = ["/", "/meu-dia", "/manifest.webmanifest", "/favicon.ico", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  // Pre-cache the new shell, but DO NOT skipWaiting automatically —
  // we wait for the client to confirm so the user isn't interrupted mid-action.
  event.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(
      SHELL.map((url) => c.add(url).catch(() => {}))
    ))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Drop every cache that isn't the current versioned one.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    // Enable navigation preload to speed up first navigation after activation.
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }
    await self.clients.claim();
    // Tell all open clients the SW activated so they can refresh data if needed.
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => c.postMessage({ type: "SW_ACTIVATED", version: SW_VERSION }));
  })());
});

// Allow the page to trigger activation of a waiting SW.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.source?.postMessage({ type: "VERSION", version: SW_VERSION });
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept Supabase / API / auth callbacks — they must always hit the network.
  if (
    url.hostname.includes("supabase.co") ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/~oauth")
  ) return;

  // For HTML navigations: network-first with preload, fallback to cached shell.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const preload = await event.preloadResponse;
        if (preload) return preload;
        const fresh = await fetch(req);
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(req)) || (await cache.match("/meu-dia")) || (await cache.match("/")) || Response.error();
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
