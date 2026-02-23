const CACHE_NAME = 'attendance-v1';
const ASSETS = [
    '/',
    '/index.html',
    '/script.js',
    '/styles.css',
    '/logo.png',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js'
];

// Install Event
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

// Activate Event
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            return cachedResponse || fetch(event.request).catch(() => {
                // If both cache and network fail, return a fallback if needed
            });
        })
    );
});
