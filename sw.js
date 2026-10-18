const SHELL = ["./","index.html","app.css","app.js","install.js","manifest.webmanifest","icon-192.png","icon-512.png"];
self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open("atelier-v3").then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open("atelier-v3").then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
