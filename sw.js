/**
 * KRKAI Service Worker — Cache-first strategy for room images
 *
 * Strategy: cache-first with a 7-day TTL.
 *   - First visit: fetch from network, store in cache.
 *   - Repeat visits within 7 days: serve from cache instantly (zero network).
 *   - After 7 days: re-fetch from network to pick up updated photos.
 *
 * Update the CACHE version (v2 → v3) whenever you push new room photos
 * so users get fresh images on their next visit.
 */

'use strict';

var CACHE       = 'krkai-images-v2';
var MAX_AGE_MS  = 7 * 24 * 60 * 60 * 1000;  // 7 days

self.addEventListener('install', function() {
  self.skipWaiting();  // activate immediately
});

self.addEventListener('activate', function(e) {
  // Remove any old cache versions
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  var url = e.request.url;

  // Only intercept GET requests for room image assets
  if (e.request.method !== 'GET') return;
  if (!url.includes('/images/rooms/')) return;

  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        // Serve from cache if fresh (within 7 days)
        if (cached) {
          var dateHeader = cached.headers.get('date');
          var age = dateHeader ? Date.now() - Date.parse(dateHeader) : 0;
          if (age < MAX_AGE_MS) return cached;
        }

        // Fetch from network, cache the result, and return it
        return fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          // Network failed — serve stale cache if available (offline fallback)
          if (cached) return cached;
        });
      });
    })
  );
});
