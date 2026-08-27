const CACHE_NAME = "kipu-static-m8-v1";
const CACHE_PREFIX = "kipu-static-";
const OFFLINE_URL = "/offline.html";
const PRECACHE_URLS = Object.freeze([
  OFFLINE_URL,
  "/icon.svg",
  "/pwa/icon/192",
  "/pwa/icon/512",
  "/pwa/icon/maskable",
]);
const SERVER_ACTION_HEADER = "next-action";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "KIPU_SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "KIPU_UNINSTALL") {
    event.waitUntil(
      caches
        .keys()
        .then((names) => Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name))))
        .then(() => self.registration.unregister()),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.method !== "GET" || request.headers.has(SERVER_ACTION_HEADER)) {
    event.respondWith(fetch(request));
    return;
  }

  const isMoneyRoute =
    url.pathname === "/app" ||
    url.pathname.startsWith("/app/") ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/");
  if (isMoneyRoute) {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  event.respondWith(fetch(request));
});
