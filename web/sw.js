// Minimal service worker so the browser can install JARVIS as its own app window.
// It caches nothing: the page carries a per-start security token and must always be fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
