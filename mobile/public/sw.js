const CACHE = "kaisho-v1"
const PRECACHE = ["/m/", "/m/icon.svg"]

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  )
  self.skipWaiting()
})

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE)
          .map((k) => caches.delete(k))
      )
    )
  )
  self.clients.claim()
})

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return
  const url = new URL(e.request.url)
  // Only cache http(s) same-origin responses
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return
  }
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (url.origin === self.location.origin) {
          const clone = res.clone()
          caches.open(CACHE).then((c) =>
            c.put(e.request, clone),
          )
        }
        return res
      })
      .catch(() => caches.match(e.request))
  )
})
