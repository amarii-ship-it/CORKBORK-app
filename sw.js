/* CORKBORK offline shell.
   The app is one HTML file. This worker keeps a copy of it on the device so
   CORKBORK opens with no connection, exactly like the local file did.

   - App files: served from the device copy immediately. When online, the
     newest version is fetched in the background and used on the next launch.
   - Libraries loaded on demand (Word layout, OCR, PDF pages): cached the
     first time they are used, then served offline.
   - Google sign-in and Drive: never cached; sync handles being offline.     */
const SHELL = "corkbork-shell-v2";
const LIBS = "corkbork-libs-v1";
const SHELL_FILES = ["./", "./index.html", "./corkboard.html", "./privacy.html", "./terms.html", "./manifest.webmanifest",
  "./icons/icon-180.png", "./icons/icon-192.png", "./icons/icon-512.png",
  "./spells-srd-2014.json", "./rules-srd-2014.json", "./items-srd-2014.json"];   /* free D&D spells, races, classes and items, so they work offline */
const LIB_HOSTS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "tessdata.projectnaptha.com"];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    /* one missing optional file must not stop the app itself being cached */
    await Promise.all(SHELL_FILES.map(f => cache.add(new Request(f, {cache:"reload"})).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (![SHELL, LIBS].includes(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function refreshShell(request, cache){
  try {
    const fresh = await fetch(request, {cache:"no-cache"});
    if (fresh.ok){
      const old = await cache.match(request);
      await cache.put(request, fresh.clone());
      const before = old ? old.headers.get("etag") || old.headers.get("last-modified") : null;
      const after = fresh.headers.get("etag") || fresh.headers.get("last-modified");
      if (old && before !== after)
        for (const client of await self.clients.matchAll()) client.postMessage({type:"corkbork-updated"});
    }
    return fresh;
  } catch (_) { return null; }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  /* the app's own update check: always ask the network */
  if (url.origin === self.location.origin && url.searchParams.has("fresh")) return;

  if (url.origin === self.location.origin){
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(request, {ignoreSearch:true});
      if (hit){ event.waitUntil(refreshShell(request, cache)); return hit; }
      const fresh = await refreshShell(request, cache);
      if (fresh) return fresh;
      /* any page of the app falls back to the cached app file */
      if (request.mode === "navigate"){
        const app = await cache.match("./corkboard.html");
        if (app) return app;
      }
      return new Response("CORKBORK is offline and this file was never saved on this device.", {status:503});
    })());
    return;
  }

  if (LIB_HOSTS.includes(url.hostname)){
    event.respondWith((async () => {
      const cache = await caches.open(LIBS);
      const hit = await cache.match(request);
      if (hit) return hit;
      const fresh = await fetch(request);
      if (fresh.ok || fresh.type === "opaque") cache.put(request, fresh.clone()).catch(() => {});
      return fresh;
    })());
  }
  /* everything else (Google sign-in, Drive, link previews) goes to the network untouched */
});
