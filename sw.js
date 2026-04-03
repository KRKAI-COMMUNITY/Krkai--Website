/**
 * KRKAI Service Worker — Cache-first strategy for images
 *
 * Strategy: cache-first with a 7-day TTL for rooms and gallery images.
 *   - First visit: fetch from network, store in cache.
 *   - Repeat visits within 7 days: serve from cache instantly (zero network).
 *   - After 7 days: re-fetch from network to pick up updated photos.
 *   - Offline: serve stale cache as fallback.
 *
 * Pre-cache: After first page load, app.js posts a 'precache' message
 *   to trigger silent background download of all room thumbnails so
 *   the next visit opens rooms instantly without any network requests.
 *
 * Update the CACHE version (v3 → v4) whenever you push new room photos
 * so users get fresh images on their next visit.
 */

'use strict';

var CACHE      = 'krkai-images-v3';
var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

self.addEventListener('install', function() {
  self.skipWaiting();  // activate immediately without waiting for existing tabs to close
});

self.addEventListener('activate', function(e) {
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
  if (e.request.method !== 'GET') return;

  // Cache room thumbnails and gallery images
  var isRoomAsset    = url.includes('/images/rooms/');
  var isGalleryAsset = url.includes('/gallery/');
  if (!isRoomAsset && !isGalleryAsset) return;

  e.respondWith(
    caches.open(CACHE).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        if (cached) {
          var dateHeader = cached.headers.get('date');
          var age = dateHeader ? Date.now() - Date.parse(dateHeader) : 0;
          if (age < MAX_AGE_MS) return cached;  // fresh cache — serve instantly
        }

        return fetch(e.request).then(function(response) {
          if (response && response.status === 200) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          if (cached) return cached;  // offline fallback — serve stale
        });
      });
    })
  );
});

// Pre-cache handler — triggered by app.js after first page load.
// Silently fetches all room thumbnails in the background so next visit is instant.
self.addEventListener('message', function(e) {
  if (!e.data || e.data.type !== 'precache') return;
  var urls = e.data.urls;
  if (!Array.isArray(urls) || urls.length === 0) return;

  caches.open(CACHE).then(function(cache) {
    // Only fetch URLs not already in cache — avoids wasting bandwidth
    var fetchQueue = urls.map(function(url) {
      return cache.match(url).then(function(cached) {
        if (cached) return;  // already have it
        return fetch(url, { priority: 'low' })
          .then(function(response) {
            if (response && response.status === 200) {
              return cache.put(url, response);
            }
          })
          .catch(function() {});  // ignore individual failures silently
      });
    });
    // Process in chunks of 5 to avoid overwhelming slow connections
    return fetchQueue.reduce(function(chain, task, i) {
      return i % 5 === 0 ? chain.then(function() { return task; }) : chain.then(function() { return task; });
    }, Promise.resolve());
  });
});
