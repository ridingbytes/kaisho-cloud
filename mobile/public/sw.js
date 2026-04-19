const CACHE = "kaisho-v6"
const PRECACHE = [
  "/m/",
  "/m/icon.svg",
  "/m/icon-192x192.png",
  "/m/manifest.json",
]

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)),
  )
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return
  const url = new URL(e.request.url)
  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    return
  }

  // API calls: network only (no stale data)
  if (url.pathname.startsWith("/auth/") ||
      url.pathname.startsWith("/clocks/") ||
      url.pathname.startsWith("/sync/") ||
      url.pathname.startsWith("/ref/") ||
      url.pathname.startsWith("/ai/") ||
      url.pathname.startsWith("/billing/")) {
    return
  }

  // Static assets: cache-first for hashed files,
  // network-first for everything else.
  if (url.pathname.includes("/assets/")) {
    e.respondWith(
      caches.match(e.request).then(
        (cached) => cached || fetch(e.request).then(
          (res) => {
            const clone = res.clone()
            caches.open(CACHE).then(
              (c) => c.put(e.request, clone),
            )
            return res
          },
        ),
      ),
    )
    return
  }

  // App shell: network-first with cache fallback
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (url.origin === self.location.origin) {
          const clone = res.clone()
          caches.open(CACHE).then(
            (c) => c.put(e.request, clone),
          )
        }
        return res
      })
      .catch(() => caches.match(e.request).then(
        (cached) => cached || caches.match("/m/"),
      )),
  )
})
