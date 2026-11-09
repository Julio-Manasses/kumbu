const CACHE = "kumbu-v5";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(FILES).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ===== FETCH =====
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  const url = new URL(e.request.url);
  const isCDN =
    url.hostname.includes("jsdelivr") || url.hostname.includes("supabase");

  // CDN → network-first com fallback cache
  if (isCDN) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(e.request, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request)),
    );
    return;
  }

  // Local → cache-first
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(e.request, copy))
            .catch(() => {});
          return res;
        })
        .catch(() => {
          if (e.request.mode === "navigate")
            return caches.match("./index.html");
        });
    }),
  );
});

// ===== BACKGROUND SYNC =====
// Quando o browser detetar rede, dispara este evento.
// A app é que processa (aqui só avisamos os clientes).
self.addEventListener("sync", (event) => {
  if (event.tag === "kumbu-sync") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "SYNC_NOW" }));
      }),
    );
  }
});

// Escuta mensagens dos clientes
self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});
