const CACHE_PREFIX = "bfsj-shell";
const CACHE_NAME = `${CACHE_PREFIX}-network-first-20260716-friend-test-2`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./fonts/misans.css",
  "./styles.css",
  "./layout-v2.css",
  "./main.js",
  "./platform.js",
  "./config.js",
  "./manifest.webmanifest",
  "./app-icon.svg",
  "./app-icon-180.png",
  "./app-icon-192.png",
  "./app-icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const appRootPath = new URL("./", self.location.href).pathname;
    const isGameShell = url.pathname === appRootPath || url.pathname === `${appRootPath}index.html`;
    const cacheKey = isGameShell ? "./index.html" : request;
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(cacheKey, copy));
          return response;
        })
        .catch(() => caches.match(cacheKey).then((cached) => cached || new Response(
          "当前离线，请恢复网络后重试。",
          { status: 503, headers: { "Content-Type": "text/plain;charset=UTF-8" } },
        ))),
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
