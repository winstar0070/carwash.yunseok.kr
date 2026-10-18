const CACHE_NAME = "carwash-offline-v20";
const APP_FILES = ["/", "/pwa.js", "/catalog-picker.js", "/catalog-data.js", "/config.js", "/sync.js", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_FILES);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("carwash-offline-") && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Register the lifetime synchronously, then keep cache writes off the response path.
function respondWithBackgroundCache(event, respond) {
  let cacheWrite = Promise.resolve();
  const response = respond((cache, key, value) => {
    if (/(?:^|,)\s*no-store\s*(?:,|$)/i.test(value.headers.get("Cache-Control") || "")) return;
    cacheWrite = Promise.resolve().then(() => cache.put(key, value.clone())).catch(() => {});
  });
  event.respondWith(response);
  event.waitUntil(response.then(() => cacheWrite).catch(() => {}));
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin || !["/", "/index.html"].includes(url.pathname)) return;
    respondWithBackgroundCache(event, async (save) => {
      const cache = await caches.open(CACHE_NAME);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch(request, { signal: controller.signal });
        if (!response.ok) throw new Error("Page unavailable");
        save(cache, "/", response);
        return response;
      } catch {
        return await cache.match("/") || Response.error();
      } finally {
        clearTimeout(timeout);
      }
    });
    return;
  }
  if (url.origin === self.location.origin && APP_FILES.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(url.pathname) || fetch(request);
    })());
    return;
  }
  if (url.origin === "https://cdn.jsdelivr.net" && url.pathname.includes("pretendard")) {
    respondWithBackgroundCache(event, async (save) => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok || response.type === "opaque") save(cache, request, response);
        return response;
      } catch {
        return Response.error();
      }
    });
  }
});
