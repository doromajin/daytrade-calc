var CACHE_NAME = 'asset-dashboard-v3';
var ASSETS = ['./','./index.html','./app.js','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  // 株価・為替APIはキャッシュせず常にネットへ
  if (url.hostname.indexOf('finnhub.io') !== -1 || url.hostname.indexOf('frankfurter.app') !== -1 || url.hostname.indexOf('frankfurter.dev') !== -1) return;
  // アプリ本体はネットワーク優先(更新を確実に反映)、失敗時のみキャッシュ
  event.respondWith(
    fetch(event.request).then(function (resp) {
      if (resp && resp.ok) {
        var clone = resp.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(event.request, clone); });
      }
      return resp;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
