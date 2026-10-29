/*
 * Service worker for the Mountain Mural Plan app.
 *
 * Registered by the page as navigator.serviceWorker.register('./sw.js'), and only over http(s).
 * Every path here is relative to the worker's scope, because the site lives at a subpath such as
 * https://OWNER.github.io/REPO/ and not at the root of the host.
 *
 * What it does:
 *   - Precaches the app shell (index.html, the manifest, the icons) so the app opens offline.
 *   - Serves the shell cache-first.
 *   - Caches the Google Fonts stylesheet and font files at runtime, so the fonts also work offline
 *     after the first visit.
 *   - Never takes over a page on its own: a new version waits until the page sends SKIP_WAITING,
 *     which the "Update available, reload" banner does.
 *   - Leaves every other request alone (it goes straight to the network).
 */
'use strict';

// ---------------------------------------------------------------------------------------------
// BUMP THIS ON EVERY DEPLOY, or installed apps never update.
//
// The browser only installs a new worker when this file's bytes change, and the shell cache is
// named after this value. Without a bump, phones that already installed the app keep serving the
// old index.html from the cache forever.
// ---------------------------------------------------------------------------------------------
const CACHE_VERSION = 'v3';

const SHELL_CACHE_PREFIX = 'mural-shell-';
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${CACHE_VERSION}`;
const FONT_CACHE = 'mural-fonts'; // not versioned: font files never change, so they survive deploys

// The scope URL always ends in "/", e.g. https://OWNER.github.io/REPO/. Resolving relative paths
// against it is what makes the same code work at the site root, at a subpath, or on localhost.
const SCOPE = self.registration.scope;
const abs = (path) => new URL(path, SCOPE).href;

// Keep this list in step with the files in docs/ (the page, the manifest and everything in icons/).
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const INDEX_URL = abs('./index.html');

// Options for matching the shell cache. ignoreVary stops a server's "Vary" header from making a
// navigation miss an entry that was stored by a plain fetch.
const SHELL_MATCH = { ignoreVary: true };

// ---------------------------------------------------------------------------------------------
// Install: fill the new shell cache. There is deliberately no skipWaiting() here.
// ---------------------------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: 'reload' skips the browser's HTTP cache, so a new deploy can never be precached
      // from stale copies (GitHub Pages lets browsers keep files for ten minutes).
      cache.addAll(SHELL_FILES.map((path) => new Request(abs(path), { cache: 'reload' })))
    )
  );
});

// The page asks for the waiting worker to take over when the user taps "Reload" on the banner.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// ---------------------------------------------------------------------------------------------
// Activate: drop the shell caches of older versions, then take control of open pages.
// ---------------------------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

// ---------------------------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // never touch POST etc.

  const url = new URL(request.url);

  // 1. Page loads: always answer from the shell, so the app opens offline. The query string is
  //    ignored (a home-screen launch might add one), and any page in the scope falls back to the
  //    cached index.html because this is a single-page app.
  if (request.mode === 'navigate') {
    event.respondWith(shellNavigation(request));
    return;
  }

  // 2. Our own files (index.html, manifest, icons): cache-first, then network.
  if (url.origin === self.location.origin && url.href.startsWith(SCOPE)) {
    event.respondWith(shellFirst(request));
    return;
  }

  // 3. Google Fonts stylesheet: serve the cached copy now and refresh it in the background.
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(event, request, FONT_CACHE));
    return;
  }

  // 4. Google Fonts font files: they never change for a given URL, so cache-first.
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(event, request, FONT_CACHE));
    return;
  }

  // 5. Anything else: no respondWith(), so the browser handles it normally (straight to network).
});

/** Navigation requests: cached page (ignoring ?query), else the cached index.html, else network. */
async function shellNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached =
    (await cache.match(request, { ...SHELL_MATCH, ignoreSearch: true })) ||
    (await cache.match(INDEX_URL, SHELL_MATCH));
  return cached || fetch(request);
}

/** Shell files: cache-first, then network. Network answers are not stored, so the cache only ever
 *  holds the files that were precached together for this version. */
async function shellFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, SHELL_MATCH);
  return cached || fetch(request);
}

/** Only store answers that are safe to replay: a complete 200, or an opaque cross-origin answer
 *  (a no-cors stylesheet or font request, whose status can't be read). cache.put() rejects 206. */
function isCacheable(response) {
  return response.status === 200 || response.type === 'opaque';
}

/** Cache-first for the runtime cache: use the stored copy if there is one, else fetch and store. */
async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    // waitUntil keeps the worker alive until the copy is stored, even after the page has its answer.
    event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
  }
  return response;
}

/** Stale-while-revalidate: answer from the cache at once and update it in the background. With
 *  nothing cached yet it simply waits for the network. */
async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = fetch(request).then(async (response) => {
    // A failed cache write must never break a good network answer, so it is swallowed.
    if (isCacheable(response)) await cache.put(request, response.clone()).catch(() => {});
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => {})); // offline: the cached copy is already on its way
    return cached;
  }
  return refresh;
}
