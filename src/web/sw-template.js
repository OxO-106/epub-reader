// Reader's service worker (issue #30). The build (vite.config.ts, `serviceWorker`) fills in VERSION and SHELL and writes
// this file as /sw.js. It keeps the app's own files so the app starts without a connection; it never keeps what the API
// answers (Books kept for offline reading live in the page's own storage, not here).
//
//  - The shell (index.html, the fingerprinted scripts and styles, the bundled fonts, the icons) is cached on install,
//    in a cache named after the build's VERSION.
//  - A new build is a new worker. It waits until every window of the old one is closed (on a phone: the next time the
//    app starts), then takes over and deletes the old caches, so a running page never loses files it still needs.
//  - Pages (navigations) go to the network first, falling back to the cached app when the PC cannot be reached.
//  - Other files of the app (/assets/, /icons/, the Chinese font in /fonts/) are served from the cache when there,
//    else fetched and kept. /api/ is never touched.

const VERSION = "__VERSION__";
const SHELL = [] /* __SHELL__ */;
const CACHE = `reader-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("reader-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "version") event.source?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match("/", { cacheName: CACHE })) ?? Response.error()),
    );
    return;
  }

  if (/^\/(assets|icons|fonts)\//.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && response.type === "basic") cache.put(request, response.clone()).catch(() => {});
        return response;
      }),
    );
  }
});
