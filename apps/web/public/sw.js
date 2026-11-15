// Service worker: only the "Нет связи" page when the network is gone.
//
// - Navigations (except /api/) go to the network as usual (navigation preload when available). On a network error the
//   cached /offline page is shown at the requested address; its "Попробовать ещё раз" link reloads that address.
// - Styles, images and fonts of the offline page are cached with it and are served from the cache only when the network
//   fails.
// - Nothing else is intercepted or cached: API calls, the BFF session (/api/session), RSC requests and pages with data
//   always go to the network.
// - The offline document runs no scripts: the cached HTML is the server render of /offline without its <script> tags,
//   served with its own CSP.
const CACHE = "teletau-offline-v1";
const OFFLINE_URL = "/offline";
const STORED_AT = "x-teletau-stored-at";
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_WEB_ORIGIN = "https://web.telegram.org";

const sameOrigin = (url) => url.origin === self.location.origin;

/** Static files of the offline document: stylesheets and images in its HTML, fonts in those stylesheets. */
function assetUrls(text, base, pattern) {
  const out = new Set();
  for (const m of text.matchAll(pattern)) {
    const url = new URL(m[1].replace(/&amp;/g, "&"), base);
    if (sameOrigin(url) && url.pathname.startsWith("/_next/static/")) out.add(url.href);
  }
  return out;
}

const HTML_ASSETS = /<(?:link|img)\b[^>]*?\b(?:href|src)="([^"]+\.(?:css|webp|png|jpe?g|svg)(?:\?[^"]*)?)"/g;
const CSS_FONTS = /url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g;

async function fetchStatic(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response;
}

/** Loads /offline and its static files into the cache; files of the previous version are removed. */
async function storeOfflinePage() {
  const page = await fetch(OFFLINE_URL, { credentials: "omit", cache: "no-store" });
  if (!page.ok) throw new Error(`${OFFLINE_URL}: ${page.status}`);
  const html = (await page.text())
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*\bas="script"[^>]*>/gi, "")
    .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/gi, "");
  const base = new URL(OFFLINE_URL, self.location.origin);
  const files = new Map();
  for (const url of assetUrls(html, base, HTML_ASSETS)) files.set(url, await fetchStatic(url));
  for (const [url, response] of [...files]) {
    if (!new URL(url).pathname.endsWith(".css")) continue;
    const css = await response.clone().text();
    for (const font of assetUrls(css, url, CSS_FONTS)) if (!files.has(font)) files.set(font, await fetchStatic(font));
  }
  const cache = await caches.open(CACHE);
  await cache.put(
    base.href,
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8", [STORED_AT]: String(Date.now()) } }),
  );
  for (const [url, response] of files) await cache.put(url, response);
  for (const request of await cache.keys()) {
    if (request.url !== base.href && !files.has(request.url)) await cache.delete(request);
  }
}

let refreshing = null;

/** Re-reads the offline page at most once a day (new design after a deploy), in the background. */
function refreshOfflinePage() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE });
    const storedAt = Number(cached?.headers.get(STORED_AT));
    if (cached && Date.now() - storedAt < REFRESH_AFTER_MS) return;
    await storeOfflinePage();
  })()
    .catch(() => undefined)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function offlineCsp(pathname) {
  const miniApp = pathname === "/miniapp" || pathname.startsWith("/miniapp/");
  return [
    "default-src 'none'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${miniApp ? TELEGRAM_WEB_ORIGIN : "'none'"}`,
  ].join("; ");
}

async function offlineResponse(request) {
  const cached = await caches.match(OFFLINE_URL, { cacheName: CACHE });
  if (!cached) return Response.error();
  return new Response(cached.body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": offlineCsp(new URL(request.url).pathname),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    },
  });
}

/** Network as is: the navigation preload response when there is one, otherwise a fetch of the same request. */
async function network(event) {
  return (await event.preloadResponse) ?? fetch(event.request);
}

async function navigate(event) {
  try {
    return await network(event);
  } catch {
    return offlineResponse(event.request);
  }
}

async function staticFile(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cached = await caches.match(request, { cacheName: CACHE });
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(storeOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith("teletau-") && name !== CACHE) await caches.delete(name);
      await self.registration.navigationPreload?.enable();
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  if (request.mode === "navigate") {
    // Downloads and redirects of the BFF: no offline page instead of them.
    if (url.pathname.startsWith("/api/")) {
      event.respondWith(network(event));
      return;
    }
    event.respondWith(navigate(event));
    event.waitUntil(refreshOfflinePage());
    return;
  }
  if (["style", "image", "font"].includes(request.destination) && url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFile(request));
  }
});
