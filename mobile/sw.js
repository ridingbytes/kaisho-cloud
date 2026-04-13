/* Kaisho Clock — Service Worker
 *
 * Caches the app shell for offline access and queues
 * clock operations when offline.
 */

var CACHE_NAME = "kaisho-v1";
var SHELL_URLS = ["/m/", "/m/index.html", "/m/app.js"];

// ── Install: cache app shell ─────────────────────────

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_URLS);
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ───────────────────────

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (k) { return k !== CACHE_NAME; })
          .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for shell

self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);

  // API requests: network-first, queue if offline
  if (
    url.pathname.startsWith("/clocks") ||
    url.pathname.startsWith("/sync") ||
    url.pathname.startsWith("/auth") ||
    url.pathname.startsWith("/ref") ||
    url.pathname.startsWith("/billing")
  ) {
    event.respondWith(
      fetch(event.request).catch(function () {
        // POST requests that fail offline get queued
        if (event.request.method === "POST") {
          return event.request.clone().json().then(
            function (body) {
              return enqueue({
                url: event.request.url,
                method: event.request.method,
                body: body,
                headers: {
                  Authorization:
                    event.request.headers.get(
                      "Authorization"
                    ) || "",
                },
              }).then(function () {
                return new Response(
                  JSON.stringify({
                    queued: true,
                    message: "Saved offline",
                  }),
                  {
                    status: 202,
                    headers: {
                      "Content-Type": "application/json",
                    },
                  }
                );
              });
            }
          );
        }
        // GET requests that fail offline: empty response
        return new Response(
          JSON.stringify([]),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      })
    );
    return;
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return (
        cached ||
        fetch(event.request).then(function (response) {
          if (
            response.ok &&
            url.pathname.startsWith("/m/")
          ) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
      );
    })
  );
});

// ── Offline queue (IndexedDB) ────────────────────────

function openDB() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open("kaisho-sw", 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore("queue", {
        autoIncrement: true,
      });
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function enqueue(item) {
  return openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction("queue", "readwrite");
      tx.objectStore("queue").add(item);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function drainQueue() {
  return openDB().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction("queue", "readwrite");
      var store = tx.objectStore("queue");
      var req = store.openCursor();
      var count = 0;
      req.onsuccess = function () {
        var cursor = req.result;
        if (!cursor) {
          resolve(count);
          return;
        }
        var item = cursor.value;
        fetch(item.url, {
          method: item.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: item.headers.Authorization,
          },
          body: JSON.stringify(item.body),
        })
          .then(function (res) {
            if (res.ok) {
              cursor.delete();
              count++;
            }
          })
          .catch(function () {})
          .then(function () {
            cursor.continue();
          });
      };
    });
  });
}

// ── Sync event: flush queue when online ──────────────

self.addEventListener("sync", function (event) {
  if (event.tag === "flush-queue") {
    event.waitUntil(drainQueue());
  }
});

// ── Periodic check: try flushing on any navigation ───

self.addEventListener("message", function (event) {
  if (event.data === "flush-queue") {
    drainQueue().then(function (count) {
      if (count > 0) {
        self.clients.matchAll().then(function (clients) {
          clients.forEach(function (c) {
            c.postMessage({
              type: "queue-flushed",
              count: count,
            });
          });
        });
      }
    });
  }
});
