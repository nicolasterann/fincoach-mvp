const CACHE_NAME = "kipu-static-m8-v2";
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

const REQUEST_POLICIES = Object.freeze({
  cacheFirst: Object.freeze({
    fallback: null,
    storesResponse: false,
    strategy: "cache-first",
  }),
  networkOnly: Object.freeze({
    fallback: null,
    storesResponse: false,
    strategy: "network-only",
  }),
  networkOnlyWithOffline: Object.freeze({
    fallback: "offline",
    storesResponse: false,
    strategy: "network-only",
  }),
  networkPassthrough: Object.freeze({
    fallback: null,
    storesResponse: false,
    strategy: "network-passthrough",
  }),
  networkWithOffline: Object.freeze({
    fallback: "offline",
    storesResponse: false,
    strategy: "network-with-offline",
  }),
});

function decideRequestPolicy({ hasServerAction, method, mode, pathname }) {
  if (method !== "GET" || hasServerAction) return REQUEST_POLICIES.networkOnly;

  const isMoneyRoute =
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/api" ||
    pathname.startsWith("/api/");
  if (isMoneyRoute) return REQUEST_POLICIES.networkOnlyWithOffline;
  if (PRECACHE_URLS.includes(pathname)) return REQUEST_POLICIES.cacheFirst;
  if (mode === "navigate") return REQUEST_POLICIES.networkWithOffline;
  return REQUEST_POLICIES.networkPassthrough;
}

// Exposed so the permanent gate can execute the exact policy used by this worker.
self.KIPU_SW_POLICY = Object.freeze({
  decideRequestPolicy,
  policies: REQUEST_POLICIES,
  precacheUrls: PRECACHE_URLS,
});

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

  const policy = decideRequestPolicy({
    hasServerAction: request.headers.has(SERVER_ACTION_HEADER),
    method: request.method,
    mode: request.mode,
    pathname: url.pathname,
  });

  if (policy.strategy === "network-only") {
    const networkResponse = fetch(request);
    event.respondWith(
      policy.fallback === "offline"
        ? networkResponse.catch(() => caches.match(OFFLINE_URL))
        : networkResponse,
    );
    return;
  }

  if (policy.strategy === "cache-first") {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
    return;
  }

  if (policy.strategy === "network-with-offline") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  event.respondWith(fetch(request));
});
