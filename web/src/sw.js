// Keeps the app's own files for offline use. The notes are never here: they live in IndexedDB.
// `just web` puts the build's digest in BUILD, so a new build replaces the old cache.
const BUILD = "__BUILD__";
const CACHE = `scrpad-${BUILD}`;
const FILES = __FILES__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("scrpad-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache first: the app starts without a network. Anything not in the cache goes to the network
// as asked, and only the site's own files exist (the page's Content-Security-Policy).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((hit) => hit ?? fetch(event.request)));
});
