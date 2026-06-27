// Service worker for OpenExpense.
// App pages: network-first (fresh when online, cached shell offline).
// Static assets: stale-while-revalidate. Asset URLs are cache-busted with a
// ?v=<version> query (see views), so a code change ships a new URL and is
// fetched fresh immediately; bumping CACHE below purges any stale copies.

const CACHE = "openexpense-v2";
const SHELL = [
  "/",
  "/login",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Receipts, uploads, and PDF exports are always live.
  if (url.pathname.startsWith("/receipt") || url.pathname.endsWith("/pdf")) return;

  const isAsset =
    url.pathname.startsWith("/css/") || url.pathname.startsWith("/js/") || url.pathname.startsWith("/icons/");

  if (isAsset) {
    // stale-while-revalidate: serve cache instantly, refresh in background.
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        const network = fetch(req)
          .then((res) => {
            if (res && res.status === 200 && res.type !== "opaque") cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || network;
      })
    );
    return;
  }

  // Pages: network-first.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
  );
});
